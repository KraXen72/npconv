/**
 * A real File whose reads wait for explicit release. Tests can choose upload
 * completion order without timers or replacing the parser/database library.
 */
export class GatedFile extends File {
	private releaseRead!: () => void;
	private readonly ready = new Promise<void>(resolve => { this.releaseRead = resolve; });

	release(): void {
		this.releaseRead();
	}

	override async text(): Promise<string> {
		await this.ready;
		return super.text();
	}

	override async arrayBuffer(): Promise<ArrayBuffer> {
		await this.ready;
		return super.arrayBuffer();
	}
}
