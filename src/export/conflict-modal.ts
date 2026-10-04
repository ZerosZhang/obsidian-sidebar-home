/**
 * 导出覆盖确认弹窗
 *
 * 目标文件夹里已有同名文件时询问用户如何处理。
 */

import { App, Modal, Setting } from 'obsidian';

export type ConflictChoice = 'overwrite' | 'skip' | 'cancel';

export class ExportConflictModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private existingCount: number,
		private onChoice: (choice: ConflictChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: '导出目标已存在' });
		contentEl.createEl('p', {
			text: `目标文件夹里已有 ${this.existingCount} 个同名文件。覆盖会直接写入并替换它们。`,
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('覆盖')
					.setCta()
					.onClick(() => this.choose('overwrite')),
			)
			.addButton((btn) =>
				btn.setButtonText('跳过已存在').onClick(() => this.choose('skip')),
			)
			.addButton((btn) =>
				btn.setButtonText('取消').onClick(() => this.choose('cancel')),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		// 点右上角关闭等同于取消
		if (!this.resolved) {
			this.resolved = true;
			this.onChoice('cancel');
		}
	}

	private choose(choice: ConflictChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.close();
		this.onChoice(choice);
	}
}
