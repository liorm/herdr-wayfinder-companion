export interface HerdrCall {
	ok: boolean;
	status: number;
	stdout: string;
	stderr: string;
	json: unknown | null;
}

export interface CommandOutput {
	status: number;
	stdout: string;
	stderr: string;
}

export type CommandRunner = (
	bin: string,
	args: string[],
) => Promise<CommandOutput>;

export class HerdrError extends Error {
	constructor(
		message: string,
		readonly call: HerdrCall,
	) {
		super(message);
		this.name = "HerdrError";
	}
}

export async function defaultRunner(
	bin: string,
	args: string[],
): Promise<CommandOutput> {
	const proc = Bun.spawn([bin, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, stderr, status] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { status, stdout, stderr };
}

function parseJson(stdout: string): unknown | null {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

export function createClient(
	binPath: string,
	runner: CommandRunner = defaultRunner,
) {
	return async function herdr(args: string[]): Promise<HerdrCall> {
		let output: CommandOutput;
		try {
			output = await runner(binPath, args);
		} catch (error) {
			const stderr = error instanceof Error ? error.message : String(error);
			return { ok: false, status: 127, stdout: "", stderr, json: null };
		}

		return {
			ok: output.status === 0,
			status: output.status,
			stdout: output.stdout,
			stderr: output.stderr,
			json: parseJson(output.stdout),
		};
	};
}

export function herdrErrorMessage(call: HerdrCall): string {
	if (call.json && typeof call.json === "object") {
		const error = (call.json as Record<string, unknown>).error;
		if (error && typeof error === "object") {
			const message = (error as Record<string, unknown>).message;
			if (typeof message === "string" && message.length > 0) return message;
		}
	}
	const text = call.stderr.trim() || call.stdout.trim();
	return text || `herdr exited ${call.status}`;
}
