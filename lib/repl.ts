/**
 * REPL
 *
 * Documented in logs/repl/README.md
 * https://github.com/smogon/pokemon-showdown/blob/master/logs/repl/README.md
 *
 * @author kota
 * @license MIT
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as repl from 'repl';
import {crashlogger} from './crashlogger';
import {FS} from './fs';
declare const Config: any;

export const Repl = new class {
	/**
	 * Contains the pathnames of all active REPL sockets.
	 */
	socketPaths: string[] = [];
	listenersSetup = false;


	setupListeners(filename: string) {
		if (Repl.listenersSetup) return;
		Repl.listenersSetup = true;

		// Clean up REPL sockets and child processes on forced exit.
		process.once('exit', code => {
			for (const s of Repl.socketPaths) {
				try {
					fs.unlinkSync(s);
				} catch {}
			}
			if (code === 129 || code === 130) {
				process.exitCode = 0;
			}
		});
		if (!process.listeners('SIGHUP').length) {
			process.once('SIGHUP', () => process.exit(128 + 1));
		}
		if (!process.listeners('SIGINT').length) {
			process.once('SIGINT', () => process.exit(128 + 2));
		}
		(global as any).heapdump = (targetPath?: string) => {
			if (!targetPath) targetPath = `${filename}-${new Date().toISOString()}`;
			let handler;
			try {
				handler = require('node-oom-heapdump')();
			} catch (e: any) {
				if (e.code !== 'MODULE_NOT_FOUND') throw e;
				throw new Error(`node-oom-heapdump is not installed. Run \`npm install --no-save node-oom-heapdump\` and try again.`);
			}
			return handler.createHeapSnapshot(targetPath);
		};
	}

	cleanOldSockets(filename: string) {
		if (filename !== 'app') return;
		try {
			const directory = path.dirname(
				path.resolve(FS.ROOT_PATH, 'logs/repl', 'app')
			);
			const files = fs.readdirSync(directory, {withFileTypes: true});
			files && files.forEach(this.cleanSocket(directory));
				
		} catch(err) {
			console.log("error reading directory: ", err);
		}
	}


	cleanSocket = (directory: string) => 
		(file: fs.Dirent) => { 
			if (!file.isSocket()) return;
			const pathname = path.join(directory, file.name);
			const socket = net.connect(pathname, () => {
				socket.end();
				socket.on("close", () => {
					console.log("socket ended gracefully");
					console.log("is destroyed: ", socket.destroyed);
					socket.destroyed || socket.destroy();
					fs.unlink(pathname, (err) => {
						if (err) {
						console.error(`Error deleting file: ${err}`);
						} else {
						console.log('File deleted.');
						}
					});
				});
			})
			.on('error', () => {
				console.log("error on socket: ", pathname)
				
			});
		}

	/**
	 * Starts a REPL server, using a UNIX socket for IPC. The eval function
	 * parametre is passed in because there is no other way to access a file's
	 * non-global context.
	 */
	start(filename: string, evalFunction: (input: string) => any) {
		const config = typeof Config !== 'undefined' ? Config : {};
		if (config.repl !== undefined && !config.repl) return;

		//const baseSocketPath = path.resolve(FS.ROOT_PATH, Config.replsocketprefix || 'logs/repl');

		// TODO: Windows does support the REPL when using named pipes. For now,
		// this only supports UNIX sockets.

		Repl.setupListeners(filename);
		this.cleanOldSockets(filename);
		
		const server = net.createServer(socket => {
			repl.start({
				input: socket,
				output: socket,
				eval(cmd, context, unusedFilename, callback) {
					try {
						return callback(null, evalFunction(cmd));
					} catch (e: any) {
						return callback(e, undefined);
					}
				},
			}).on('exit', () => socket.end());
			socket.on('error', () => {
				console.log("Where my errrors at??!?")
				socket.destroy()
			});
		});

		const pathname = path.resolve(FS.ROOT_PATH, Config.replsocketprefix || 'logs/repl', filename);
		try {
			server.listen(pathname, () => {
				fs.chmodSync(pathname, Config.replsocketmode || 0o600);
				Repl.socketPaths.push(pathname);
			});

			server.once('error', (err: NodeJS.ErrnoException) => {
				console.log("Socket server error: ", err);
				server.close();
				if (err.code === "EADDRINUSE") {
					fs.unlink(pathname, _err => {
						if (_err && _err.code !== "ENOENT") {
							crashlogger(_err, `REPL: ${filename}`);
						}
					});
				} else if (err.code === "EACCES") {
					if (process.platform !== 'win32') {
						console.error(`Could not start REPL server "${filename}": Your filesystem doesn't support Unix sockets (everything else will still work)`);
					}
				} else {
					crashlogger(err, `REPL: ${filename}`);
				}
			});

			server.once('close', () => {
				Repl.socketPaths = Repl.socketPaths.filter((v) => v === pathname);
			});
		} catch (err) {
			console.error(`Could not start REPL server "${filename}": ${err}`);
		}
	}
};
