import { expect, test } from "bun:test";
import { chmodSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const fixture = new URL("./fixtures/gh", import.meta.url).pathname;

function testEnv(context: Record<string, unknown>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${new URL("./fixtures", import.meta.url).pathname}:${process.env.PATH ?? ""}`,
		HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(context),
	};
	delete env.HERDR_PANE_ID;
	delete env.HERDR_BIN_PATH;
	delete env.HERDR_PLUGIN_ENTRYPOINT_ID;
	delete env.HERDR_WORKSPACE_ID;
	delete env.HERDR_TAB_ID;
	delete env.CI;
	delete env.CONTINUOUS_INTEGRATION;
	delete env.GITHUB_ACTIONS;
	return env;
}

test("the pane lists issues from gh and closes on q", async () => {
	chmodSync(fixture, 0o755);
	const script = `
import os, pty, select, time, sys, struct, fcntl, termios
command = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    try:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    except Exception:
        pass
    os.execvpe(command[0], command, os.environ)
    os._exit(127)
try:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
except Exception:
    pass
data = b""
mark = 0
sent_enter = False
sent_escape = False
sent_quit = False
deadline = time.time() + 20
status = None
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(fd, 8192)
        except OSError:
            chunk = b""
        if chunk:
            data += chunk
        elif sent_quit:
            break
    if (not sent_enter) and b"Fix the gate" in data:
        sent_enter = True
        mark = len(data)
        os.write(fd, b"\\r")
    elif sent_enter and (not sent_escape) and b"esc back" in data[mark:]:
        sent_escape = True
        mark = len(data)
        os.write(fd, b"\\x1b")
    elif sent_escape and (not sent_quit) and b"j/k move" in data[mark:]:
        sent_quit = True
        os.write(fd, b"q")
    done, status = os.waitpid(pid, os.WNOHANG)
    if done != 0:
        break
else:
    sys.stderr.buffer.write(data)
    sys.exit(1)
if not sent_quit:
    sys.stderr.buffer.write(data)
    sys.exit(1)
exited = os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
if not exited:
    sys.stderr.buffer.write(data)
    sys.exit(1)
`;
	const proc = Bun.spawn(
		["python3", "-c", script, process.execPath, "src/main.ts", "ui"],
		{
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
			env: testEnv({ focused_pane_cwd: root }),
		},
	);
	const [stdout, stderr, status] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect({ status, stderr, stdout }).toEqual({
		status: 0,
		stderr: "",
		stdout: "",
	});
}, 30_000);

test("ui prints the issue list when it is not attached to a terminal", async () => {
	chmodSync(fixture, 0o755);
	const proc = Bun.spawn([process.execPath, "src/main.ts", "ui"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
		env: testEnv({ workspace_cwd: root }),
	});
	const [stdout, stderr, status] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(status).toBe(0);
	expect(stderr).toBe("");
	expect(stdout).toContain("acme/widgets  (open)");
	expect(stdout).toContain("#7  Fix the gate  bug");
});
