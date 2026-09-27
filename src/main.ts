import { help, open, status, ui } from "./commands.ts";

const command = process.argv[2] ?? "help";

const code = await (async (): Promise<number> => {
	switch (command) {
		case "status":
			return status();
		case "open":
			return open();
		case "ui":
			return ui();
		case "help":
		case "--help":
		case "-h":
			help();
			return 0;
		default:
			console.error(`unknown command: ${command}`);
			help();
			return 2;
	}
})();

process.exit(code);
