/**
 * Edge-TTS 客户端：tls 直连 + 手动 WebSocket，完全对齐 Python edge-tts 协议
 */
import * as tls from 'tls';
import * as crypto from 'crypto';

export interface EdgeTtsOptions {
	voice: string;
	rate: string;
	pitch: string;
}

const HOST = 'speech.platform.bing.com';
const PORT = 443;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_MAJOR = '143';
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' +
	` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36` +
	` Edg/${CHROMIUM_MAJOR}.0.0.0`;
const WIN_EPOCH = 11644473600;

function uuid(): string {
	return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = Math.random() * 16 | 0;
		return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
	});
}

function dateToString(): string {
	const d = new Date();
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

function generateSecMsGec(): string {
	const now = Date.now() / 1000;
	let ticks = (now + WIN_EPOCH);
	ticks = ticks - (ticks % 300);
	ticks = ticks * 10000000;
	const strToHash = `${Math.floor(ticks)}${TRUSTED_CLIENT_TOKEN}`;
	return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function generateMuid(): string {
	return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function buildSsml(text: string, options: EdgeTtsOptions): string {
	const escaped = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
	return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${options.voice}'><prosody pitch='${options.pitch}' rate='${options.rate}' volume='+0%'>${escaped}</prosody></voice></speak>`;
}

function encodeWsFrame(payload: string): Buffer {
	const buf = Buffer.from(payload, 'utf-8');
	const mask = crypto.randomBytes(4);
	const masked = Buffer.allocUnsafe(buf.length);
	for (let i = 0; i < buf.length; i++) masked[i] = buf[i] ^ mask[i % 4];

	if (buf.length < 126) {
		const header = Buffer.allocUnsafe(6);
		header[0] = 0x81;
		header[1] = 0x80 | buf.length;
		mask.copy(header, 2);
		return Buffer.concat([header, masked]);
	} else if (buf.length < 65536) {
		const header = Buffer.allocUnsafe(8);
		header[0] = 0x81;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(buf.length, 2);
		mask.copy(header, 4);
		return Buffer.concat([header, masked]);
	} else {
		const header = Buffer.allocUnsafe(14);
		header[0] = 0x81;
		header[1] = 0x80 | 127;
		header.writeBigInt64BE(BigInt(buf.length), 2);
		mask.copy(header, 10);
		return Buffer.concat([header, masked]);
	}
}

function parseFrames(buf: Buffer, pos: number): { frames: Array<{ type: 'text'; data: string } | { type: 'binary'; data: Buffer }>; consumed: number } {
	const frames: Array<{ type: 'text'; data: string } | { type: 'binary'; data: Buffer }> = [];
	let i = pos;

	while (buf.length - i >= 2) {
		const opcode = buf[i] & 0x0f;
		const masked = (buf[i + 1] & 0x80) !== 0;
		let payloadLen = buf[i + 1] & 0x7f;
		let offset = i + 2;

		if (payloadLen === 126) {
			if (buf.length - offset < 2) break;
			payloadLen = buf.readUInt16BE(offset);
			offset += 2;
		} else if (payloadLen === 127) {
			if (buf.length - offset < 8) break;
			payloadLen = Number(buf.readBigInt64BE(offset));
			offset += 8;
		}

		const maskLen = masked ? 4 : 0;
		if (buf.length - offset < maskLen + payloadLen) break;

		const payload = Buffer.allocUnsafe(payloadLen);
		if (masked) {
			const mk = buf.slice(offset, offset + 4);
			for (let j = 0; j < payloadLen; j++) payload[j] = buf[offset + 4 + j] ^ mk[j % 4];
		} else {
			buf.copy(payload, 0, offset, offset + payloadLen);
		}
		offset += maskLen + payloadLen;

		if (opcode === 0x01) frames.push({ type: 'text', data: payload.toString('utf-8') });
		else if (opcode === 0x02) frames.push({ type: 'binary', data: payload });
		else if (opcode === 0x08) {
			// Close 帧：前 2 字节是 code，后面是 reason
			let closeCode = 0, closeReason = '';
			if (payloadLen >= 2) { closeCode = payload.readUInt16BE(0); }
			if (payloadLen > 2) { closeReason = payload.slice(2).toString('utf-8'); }
			frames.push({ type: 'text', data: `CLOSE:${closeCode}:${closeReason}` });
		}
		i = offset;
	}

	return { frames, consumed: i };
}

export async function generateEdgeTts(text: string, options: EdgeTtsOptions): Promise<ArrayBuffer> {
	console.log('[Edge-TTS] 连接 (修正协议), voice=', options.voice);
	return new Promise((resolve, reject) => {
		const wsKey = crypto.randomBytes(16).toString('base64');
		const requestId = uuid();
		const connectionId = uuid();
		const timestamp = dateToString();
		const secMsGec = generateSecMsGec();
		const muid = generateMuid();
		const audioChunks: Buffer[] = [];
		let recvBuf = Buffer.alloc(0);
		let connected = false;
		let closed = false;
		let frameCount = 0;
		let textFrameCount = 0;
		let binaryFrameCount = 0;

		// Sec-MS-GEC 放在 URL 查询参数中（不是 HTTP 头！）
		const path = `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

		const socket = tls.connect({
			host: HOST, port: PORT, servername: HOST,
			rejectUnauthorized: false,
			ALPNProtocols: ['http/1.1'],
		});
		socket.setNoDelay(true);

		socket.on('secureConnect', () => {
			console.log('[Edge-TTS] TLS OK, Sec-MS-GEC=', secMsGec.slice(0, 16) + '...');
			const req = [
				`GET ${path} HTTP/1.1`,
				`Host: ${HOST}`,
				`Connection: Upgrade`,
				`Upgrade: websocket`,
				`Sec-WebSocket-Version: 13`,
				`Sec-WebSocket-Key: ${wsKey}`,
				`Pragma: no-cache`,
				`Cache-Control: no-cache`,
				`Origin: ${EDGE_ORIGIN}`,
				`Accept-Encoding: gzip, deflate, br, zstd`,
				`Accept-Language: en-US,en;q=0.9`,
				`User-Agent: ${EDGE_UA}`,
				`Cookie: muid=${muid};`,
				``, ``,
			].join('\r\n');
			socket.write(req);
		});

		socket.on('data', (chunk: Buffer) => {
			if (!connected) {
				const response = chunk.toString('utf-8');
				console.log('[Edge-TTS] 响应:', response.slice(0, 200));
				if (response.includes('101')) {
					console.log('[Edge-TTS] 升级成功!');
					connected = true;

					// 1) config 消息 (Path: speech.config)
					const wordBoundary = 'false';
					const sentenceBoundary = 'false';
					const configMsg = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"${sentenceBoundary}","wordBoundaryEnabled":"${wordBoundary}"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
					socket.write(encodeWsFrame(configMsg));

					// 2) SSML 消息（text 参数已是完整 SSML）
					const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${text}`;
					socket.write(encodeWsFrame(ssmlMsg));
					return;
				}
				if (response.match(/HTTP\/1\.1 [45]/)) {
					console.error('[Edge-TTS] 拒绝:', response.slice(0, 200));
					if (!closed) { closed = true; socket.end(); reject(new Error('服务端拒绝')); }
					return;
				}
				return;
			}

			recvBuf = Buffer.concat([recvBuf, chunk]);
			console.log('[Edge-TTS] recv chunk size=', chunk.length, ' totalBuf=', recvBuf.length,
				' hex=', recvBuf.slice(0, Math.min(40, recvBuf.length)).toString('hex'));
			let pos = 0;
			while (pos < recvBuf.length) {
				const { frames, consumed } = parseFrames(recvBuf, pos);
				if (consumed === pos) break; // 没有完整的帧可解析
				pos = consumed;
				for (const frame of frames) {
					frameCount++;
					if (frame.type === 'text') {
						textFrameCount++;
						const preview = frame.data.slice(0, 300);
						console.log(`[Edge-TTS] 文本帧 #${textFrameCount}:`, preview);
						if (frame.data.startsWith('CLOSE:')) {
							console.error('[Edge-TTS] 服务端关闭连接:', frame.data);
							if (!closed) {
								closed = true;
								socket.destroy();
								if (audioChunks.length > 0) {
									resolve(Buffer.concat(audioChunks).buffer as ArrayBuffer);
								} else {
									reject(new Error(`Edge-TTS: ${frame.data}`));
								}
							}
							return;
						}
						if (frame.data.includes('Path:turn.end')) {
							console.log('[Edge-TTS] turn.end, 音频块=', audioChunks.length, '总大小=', audioChunks.reduce((s, c) => s + c.length, 0));
							if (!closed) {
								closed = true;
								socket.destroy();
								if (audioChunks.length > 0) {
									resolve(Buffer.concat(audioChunks).buffer as ArrayBuffer);
								} else {
									reject(new Error('无音频数据'));
								}
							}
							return;
						}
					} else if (frame.type === 'binary') {
						binaryFrameCount++;
						const preview = frame.data.slice(0, 40).toString('hex');
						console.log(`[Edge-TTS] 二进制帧 #${binaryFrameCount}: len=${frame.data.length}, 前40B hex=`, preview);
						if (frame.data.length < 2) {
							console.log('[Edge-TTS] 二进制帧太短，跳过');
							continue;
						}
						const headerLen = frame.data.readUInt16BE(0);
						console.log(`[Edge-TTS] 二进制帧 headerLen=`, headerLen, ' dataLen=', frame.data.length);
						if (headerLen + 2 > frame.data.length) {
							console.log('[Edge-TTS] headerLen 超出，跳过');
							continue;
						}
						const headers = frame.data.slice(2, 2 + headerLen).toString();
						console.log(`[Edge-TTS] 二进制帧 headers:`, headers.slice(0, 200));
						if (headers.includes('Path:audio')) {
							const audio = frame.data.slice(2 + headerLen);
							console.log(`[Edge-TTS] 音频数据:`, audio.length, 'bytes');
							if (audio.length > 0) audioChunks.push(audio);
						}
					}
				}
			}
			recvBuf = recvBuf.slice(pos);
		});

		socket.on('error', (err) => { if (!closed) { closed = true; reject(err); } });
		socket.on('close', () => { if (!closed) { closed = true; reject(new Error('连接意外关闭')); } });

		setTimeout(() => { if (!closed) { closed = true; socket.destroy(); reject(new Error('超时')); } }, 180000);
	});
}
