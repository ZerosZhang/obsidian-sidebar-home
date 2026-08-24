/**
 * TTS 播放器：调度 Edge-TTS 和 Web Speech，管理播放状态，控制编辑器高亮
 */
import { App, MarkdownView, Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { SidebarHomeSettings } from '../settings';
import { cleanMarkdownForTts } from './markdown-cleaner';
import { splitSentences, findSentenceOffsets } from './sentence-splitter';
import { generateEdgeTts } from './edge-tts';
import { highlightRange, clearHighlight as clearCmHighlight } from './tts-highlight';

export type PlayState = 'idle' | 'generating' | 'playing' | 'paused' | 'stopped';

export class TtsPlayer {
	private app: App;
	private settings: SidebarHomeSettings;
	private audioEl: HTMLAudioElement | null = null;
	private state: PlayState = 'idle';
	private aborted = false; // 中断标志，防止重复播放
	private sentences: string[] = [];
	private sentenceOffsets: Array<{ start: number; end: number }> = [];
	private highlightBaseOffset: number = 0; // playFromSelection 时的原文偏移补偿
	private currentSentenceIndex: number = -1;
	private fullText: string = '';
	private generationAborter: (() => void) | null = null;

	// 回调
	onStateChange: ((state: PlayState) => void) | null = null;
	onSentenceChange: ((index: number, total: number) => void) | null = null;

	constructor(app: App, settings: SidebarHomeSettings) {
		this.app = app;
		this.settings = settings;
		console.log('[TTS-Player] 初始化, app=', !!app, ' settings=', !!settings);
		console.log('[TTS-Player] voice=', settings.ttsVoice, ' speed=', settings.ttsSpeed);
	}

	getState(): PlayState {
		return this.state;
	}

	getProgress(): { current: number; total: number } {
		return { current: this.currentSentenceIndex + 1, total: this.sentences.length };
	}

	private setState(state: PlayState) {
		this.state = state;
		this.onStateChange?.(state);
	}

	async playFullNote(mdText: string, startOffset?: number) {
		console.log('[TTS-Player] playFullNote 开始, 文本长度=', mdText?.length ?? 0, ' startOffset=', startOffset);
		this.stop();
		this.aborted = false;

		const plainText = cleanMarkdownForTts(mdText);
		console.log('[TTS-Player] 清洗后长度=', plainText.length, ' preview=', plainText.slice(0, 50));
		if (!plainText) {
			console.log('[TTS-Player] 清洗后文本为空，退出');
			return;
		}

		// 如果指定了起始偏移，从该偏移开始清洗
		let effectivePlainText = plainText;
		let effectiveMdText = mdText;
		let sentenceOffset = 0;
		if (startOffset !== undefined && startOffset > 0) {
			const beforeMd = mdText.slice(0, startOffset);
			const beforePlain = cleanMarkdownForTts(beforeMd);
			// 定位原文中第 startOffset 个字符对应的清洗后偏移
			const afterMd = mdText.slice(startOffset);
			effectivePlainText = cleanMarkdownForTts(afterMd);
			sentenceOffset = beforePlain.length;
			// 合并清洗后的完整纯文本用于分句定位
			// 实际使用时用 effectivePlainText (选中之后的纯文本)
		}

		this.sentences = splitSentences(effectivePlainText);
		console.log('[TTS-Player] 分句数量=', this.sentences.length);
		if (this.sentences.length === 0) {
			console.log('[TTS-Player] 分句为零，退出');
			return;
		}

		// 句子偏移量用 effectiveMdText 与 effectivePlainText 对齐
		effectiveMdText = startOffset ? mdText.slice(startOffset) : mdText;
		this.sentenceOffsets = findSentenceOffsets(effectiveMdText, this.sentences);
		this.highlightBaseOffset = startOffset ?? 0;
		this.fullText = effectiveMdText;
		this.currentSentenceIndex = -1;

		console.log('[TTS-Player] navigator.onLine=', navigator.onLine);

		const BATCH_SIZE = 5;
		const batches: string[][] = [];
		for (let i = 0; i < this.sentences.length; i += BATCH_SIZE) {
			batches.push(this.sentences.slice(i, i + BATCH_SIZE));
		}
		console.log('[TTS-Player] 分为', batches.length, '批');

		this.setState('generating');

		try {
			// 生成第一批
			let currentBatch = 0;
			const firstSsml = this.buildBatchSsml(batches[0]);
			console.log('[TTS-Player] 生成第 1 批, SSML长度=', firstSsml.length, ' 内容:', firstSsml.slice(0, 300));
			let readyBuffer = await generateEdgeTts(firstSsml, {
				voice: 'zh-CN-XiaoxiaoNeural',
				rate: String(this.settings.ttsSpeed),
				pitch: '+0Hz',
			});
			currentBatch = 1;
			console.log('[TTS-Player] 第 1 批就绪, size=', readyBuffer.byteLength);

			// 后台生成队列
			const preGenerated: ArrayBuffer[] = [];
			let preGenDone = false;
			(async () => {
				for (let b = 1; b < batches.length; b++) {
					if (this.aborted) { preGenDone = true; return; }
					const ssml = this.buildBatchSsml(batches[b]);
					console.log('[TTS-Player] 后台生成第', b + 1, '批, SSML=', ssml.length);
					try {
						const buf = await generateEdgeTts(ssml, {
							voice: 'zh-CN-XiaoxiaoNeural',
							rate: String(this.settings.ttsSpeed),
							pitch: '+0Hz',
						});
						preGenerated.push(buf);
						console.log('[TTS-Player] 第', b + 1, '批就绪, 队列=', preGenerated.length);
					} catch (e) {
						console.error('[TTS-Player] 第', b + 1, '批失败:', e);
					}
				}
				preGenDone = true;
			})();

			// 串联播放：播放当前 → ended → 取下一批 → 播放
			const playLoop = async () => {
				while (true) {
					if (this.aborted) { this.clearHighlight(); return; }
					const blob = new Blob([readyBuffer], { type: 'audio/mpeg' });
					const url = URL.createObjectURL(blob);

					this.audioEl = new Audio(url);
					const batchIdx = currentBatch;
					this.audioEl.addEventListener('timeupdate', () => {
						if (!this.audioEl || !this.audioEl.duration) return;
						const progress = this.audioEl.currentTime / this.audioEl.duration;
						const batchSents = batches[batchIdx - 1];
						const totalChars = batchSents.reduce((s: number, t: string) => s + t.length, 0);
						let charSum = 0;
						for (let i = 0; i < batchSents.length; i++) {
							charSum += batchSents[i].length;
							if (progress <= charSum / totalChars || i === batchSents.length - 1) {
								const globalIdx = (batchIdx - 1) * BATCH_SIZE + i;
								if (globalIdx !== this.currentSentenceIndex) {
									this.currentSentenceIndex = globalIdx;
									this.highlightSentence(globalIdx);
									this.onSentenceChange?.(globalIdx, this.sentences.length);
								}
								break;
							}
						}
					});

					this.audioEl.addEventListener('error', (e) => {
						console.error('[TTS-Player] Audio错误:', e);
						this.cleanupAudio();
						this.playWithWebSpeech();
					});

					this.setState('playing');

					await new Promise<void>((resolve) => {
						this.audioEl!.addEventListener('ended', () => {
							URL.revokeObjectURL(url);
							this.audioEl = null;
							if (this.aborted) { resolve(); return; }
							resolve();
						}, { once: true });
						this.audioEl!.play();
					});

					if (this.aborted) { this.clearHighlight(); return; }

					// 取下一批
					while (preGenerated.length === 0 && !preGenDone) {
						await new Promise(r => setTimeout(r, 200));
					}
					if (preGenerated.length > 0) {
						readyBuffer = preGenerated.shift()!;
						currentBatch++;
					} else if (preGenDone) {
						break;
					}
				}

				this.clearHighlight();
				this.setState('stopped');
			};

			await playLoop();
		} catch (e) {
			console.error('[TTS-Player] Edge-TTS 失败:', e);
			this.cleanupAudio();
			new Notice('Edge-TTS 不可用，降级到本地语音');
			await this.playWithWebSpeech();
		}
	}

	playSelection(text: string) {
		console.log('[TTS-Player] playSelection 开始, 文本长度=', text?.length ?? 0);
		this.stop();
		const plainText = cleanMarkdownForTts(text);
		console.log('[TTS-Player] 清洗后=', plainText.slice(0, 50));
		if (!plainText) return;

		this.sentences = splitSentences(plainText);
		if (this.sentences.length === 0) return;

		this.currentSentenceIndex = 0;
		console.log('[TTS-Player] 使用 Web Speech 朗读选中文本');
		this.speakWithWebSpeech(plainText, () => this.setState('stopped'));
		this.setState('playing');
	}

	/**
	 * 从选中文本所在的完整句子开始，一直读到文末
	 */
	playFromSelection(fullMdText: string, selectedText: string) {
		console.log('[TTS-Player] playFromSelection, 选中=', selectedText.slice(0, 50));
		this.stop();

		// 在原文中定位选中文本
		const selStart = fullMdText.indexOf(selectedText);
		if (selStart < 0) {
			console.log('[TTS-Player] 选中文本在原文中未定位到，改为朗读全文');
			this.playFullNote(fullMdText);
			return;
		}

		// 向前找到选中文本所在句子的开头
		const before = fullMdText.slice(0, selStart);
		const sentenceStartPattern = /[。！？；!?;…\.\n](?=[^。！？；!?;…\.\n]*$)/;
		const match = before.match(sentenceStartPattern);
		const sentenceStart = match ? match.index! + 1 : 0;

		// 从该句子到文末
		const fromSentence = fullMdText.slice(sentenceStart);
		console.log('[TTS-Player] 从第', sentenceStart, '字符开始, 剩余长度=', fromSentence.length);
		this.playFullNote(fullMdText, sentenceStart);
	}

	pause() {
		if (this.audioEl && this.state === 'playing') {
			this.audioEl.pause();
			this.setState('paused');
		} else if (this.state === 'playing') {
			// Web Speech: pause via synthesis
			window.speechSynthesis.pause();
			this.setState('paused');
		}
	}

	resume() {
		if (this.audioEl && this.state === 'paused') {
			this.audioEl.play();
			this.setState('playing');
		} else if (this.state === 'paused') {
			window.speechSynthesis.resume();
			this.setState('playing');
		}
	}

	stop() {
		this.aborted = true;
		if (this.audioEl) {
			this.audioEl.pause();
			this.cleanupAudio();
		}
		window.speechSynthesis.cancel();
		this.clearHighlight();
		this.setState('stopped');
		this.sentences = [];
		this.sentenceOffsets = [];
		this.highlightBaseOffset = 0;
		this.currentSentenceIndex = -1;
	}

	private cleanupAudio() {
		if (this.audioEl) {
			if (this.audioEl.src.startsWith('blob:')) {
				URL.revokeObjectURL(this.audioEl.src);
			}
			this.audioEl.removeEventListener('timeupdate', () => this.onTimeUpdate());
			this.audioEl.removeEventListener('ended', () => this.onEnded());
			this.audioEl = null;
		}
	}

	private onTimeUpdate() {
		if (!this.audioEl || this.sentences.length === 0) return;

		const progress = this.audioEl.currentTime / (this.audioEl.duration || 1);

		const totalChars = this.sentences.reduce((s, t) => s + t.length, 0);
		let charSum = 0;
		for (let i = 0; i < this.sentences.length; i++) {
			charSum += this.sentences[i].length;
			const ratio = charSum / totalChars;
			if (progress <= ratio || i === this.sentences.length - 1) {
				if (i !== this.currentSentenceIndex) {
					this.currentSentenceIndex = i;
					this.highlightSentence(i);
					this.onSentenceChange?.(i, this.sentences.length);
				}
				break;
			}
		}
	}

	private onEnded() {
		this.clearHighlight();
		this.cleanupAudio();
		this.setState('stopped');
	}

	// ========== Web Speech 降级 ==========

	private async playWithWebSpeech() {
		console.log('[TTS-Player] playWithWebSpeech 开始, 句子数=', this.sentences.length);
		const fullText = this.sentences.join(' ');
		return new Promise<void>((resolve) => {
			let idx = 0;
			const speakNext = () => {
				if (idx >= this.sentences.length || this.state === 'stopped') {
					console.log('[TTS-Player] Web Speech 播放完毕, idx=', idx, ' state=', this.state);
					this.setState('stopped');
					this.clearHighlight();
					resolve();
					return;
				}
				this.currentSentenceIndex = idx;
				this.highlightSentence(idx);
				this.onSentenceChange?.(idx, this.sentences.length);
				console.log('[TTS-Player] Web Speech 播放句子 ', idx + 1, '/', this.sentences.length, ': ', this.sentences[idx].slice(0, 30));
				this.speakWithWebSpeech(this.sentences[idx], () => {
					idx++;
					speakNext();
				});
			};
			this.setState('playing');
			speakNext();
		});
	}

	private speakWithWebSpeech(text: string, onEnd: () => void) {
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'zh-CN';
		utterance.rate = this.settings.ttsSpeed;

		// 应用用户选择的音色
		if (this.settings.ttsVoice) {
			const voices = window.speechSynthesis.getVoices();
			const match = voices.find(v => v.voiceURI === this.settings.ttsVoice);
			if (match) {
				utterance.voice = match;
			}
		}

		utterance.onend = () => {
			console.log('[TTS-Player] Web Speech utterance ended');
			onEnd();
		};
		utterance.onerror = (e) => {
			console.error('[TTS-Player] Web Speech 播放失败:', e);
			onEnd();
		};
		utterance.onstart = () => {
			console.log('[TTS-Player] Web Speech utterance started');
		};
		window.speechSynthesis.speak(utterance);
	}

	// ========== SSML 构建 ==========

	private buildBatchSsml(sentences: string[]): string {
		const safe = sentences.map(s => this.sanitizeText(s));
		const escaped = safe.map(s => this.escapeXml(s)).join('。');
		return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${this.settings.ttsEdgeVoice}"><prosody rate="${this.settings.ttsSpeed}" pitch="+0Hz">${escaped}</prosody></voice></speak>`;
	}

	/** 移除 XML 不兼容字符（对齐 Python edge-tts 的 remove_incompatible_characters） */
	private sanitizeText(s: string): string {
		let result = '';
		for (let i = 0; i < s.length; i++) {
			const code = s.charCodeAt(i);
			if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) {
				result += ' ';
			} else {
				result += s[i];
			}
		}
		return result;
	}

	private escapeXml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// ========== 编辑器高亮 ==========

	private getCmView(): EditorView | null {
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf && activeLeaf.view instanceof MarkdownView) {
			return (activeLeaf.view.editor as unknown as { cm: EditorView }).cm ?? null;
		}
		// fallback: 查找任意 markdown leaf
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			const v = leaf.view;
			if (v instanceof MarkdownView) {
				return (v.editor as unknown as { cm: EditorView }).cm ?? null;
			}
		}
		return null;
	}

	private highlightSentence(index: number) {
		if (index < 0 || index >= this.sentenceOffsets.length) return;
		const cm = this.getCmView();
		if (!cm) return;

		const { start, end } = this.sentenceOffsets[index];
		const actualStart = start + this.highlightBaseOffset;
		const actualEnd = end + this.highlightBaseOffset;
		if (actualStart >= 0 && actualEnd > actualStart) {
			highlightRange(cm, actualStart, actualEnd);
		}
	}

	private clearHighlight() {
		const cm = this.getCmView();
		if (cm) clearCmHighlight(cm);
	}

	/**
	 * 清除指定文件的缓存音频
	 */
	static clearCache(): void {
		// 缓存清除逻辑（后续版本实现本地 IndexedDB 缓存）
	}
}
