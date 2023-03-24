/**
 * REPL
 *
 * Documented in logs/repl/README.md
 * https://github.com/smogon/pokemon-showdown/blob/master/logs/repl/README.md
 *
 * @author kota
 * @license MIT
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import repl from 'repl';
import { crashlogger } from './crashlogger';
import { FS } from './fs';
declare const Config: any;


const activeSockets: { [key: string]: net.Socket } = {};


removeSocketsOnProcessExit();

function destroySocket(path: string, socket?: net.Socket) {
	console.log("destroying socket: ", path);
	if(socket) socket.destroyed || socket.destroy();
	console.log("deleting socket: ", path);
	fs.unlink(path, (err) => {
		if (err) {
			console.error(`Error socket file: ${err}`);
		} else {
			console.log('Socket File deleted.');
		}
	});
}

function endSocket(path: string, socket?: net.Socket) {
	console.log("ending socket: ", path);
	socket && socket.end();
	activeSockets[path] && delete activeSockets[path];
}

function removeSocketsOnProcessExit() {
	const config = typeof Config !== 'undefined' ? Config : {};
	if (config.repl !== undefined && !config.repl) return;
	
	// Clean up REPL sockets and child processes on forced exit.
	const basePath = path.resolve(
		FS.ROOT_PATH, config.replsocketprefix || 'logs/repl',
	)
	process.once('exit', code => {
		console.log("Process is exiting");
		console.log("removing sockets on exit");
		console.log(activeSockets);
		try {
			for(const [k, v] of Object.entries(activeSockets)) {
				console.log("ending socket on exit: ", k)
				endSocket(path.join(basePath, k), v);
			}
			// 
			// for(const file of files) {
			// 	if(!file.isSocket()) continue;

			// 	const socketPath = path.join(basePath, file.name);
			// 	endSocket(socketPath, activeSockets[socketPath]);
			// }
		} catch(err) {
			console.log('Error deleting sockets on exit: ', err);
		}

		// Should we do this?
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
		if (!targetPath) targetPath = `${path}-${new Date().toISOString()}`;
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
	
	
/**
 * Starts a REPL server, using a UNIX socket for IPC. The eval function
 * parametre is passed in because there is no other way to access a file's
 * non-global context.
 */
function start(filename: string, evalFunction: (input: string) => any) {
	const config = typeof Config !== 'undefined' ? Config : {};
	if (config.repl !== undefined && !config.repl) return;
	console.log("starting server: ", filename);
	const filePath = path.resolve(
		FS.ROOT_PATH, config.replsocketprefix || 'logs/repl', filename
	)

	//const baseSocketPath = path.resolve(FS.ROOT_PATH, Config.replsocketprefix || 'logs/repl');

	// TODO: Windows does support the REPL when using named pipes. For now,
	// this only supports UNIX sockets.
	
	const server = net.createServer(socket => {
		console.log("new active socket");
		activeSockets[filePath] = socket;
		
		console.log(activeSockets)
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
		}).on('exit', () => endSocket(filePath, socket));
		socket.on('close', () => {
			destroySocket(filePath, socket);
		})
		socket.on('error', (err) => {
			console.log("socket error: ", err);
			delete activeSockets[filePath];
			destroySocket(filePath, socket);
		});
	});

	console.log("listen on filepath: ", filePath);
	server.listen(filePath, () => {
		console.log("listening on filepath: ", filePath)
		fs.chmodSync(filePath, Config.replsocketmode || 0o600);
	});

	server.once('close', () => {
		console.log("socket server closed: ", filePath)
	});

	server.once('error', (err: NodeJS.ErrnoException) => {
		//console.log("Socket server error: ", err);
		server.close();
		if (err.code === "EADDRINUSE") {
			fs.unlink(filePath, _err => {
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
}

export const Repl = { start };






// function cleanSockets() {
// 	if (filename !== 'app') return;
// 	try {
// 		const directory = path.dirname(
// 			path.resolve(FS.ROOT_PATH, 'logs/repl', 'app')
// 		);
// 		const files = fs.readdirSync(directory, {withFileTypes: true});
// 		files && files.forEach(this.cleanSocket(directory));
			
// 	} catch(err) {
// 		console.log("error reading directory: ", err);
// 	}
// }


// cleanSocket = (name: string) => 
// 	(file: fs.Dirent) => { 
// 		if (!file.isSocket()) return;
// 		const pathname = path.join(directory, file.name);
// 		const socket = net.connect(pathname, () => {
// 			socket.end();
// 			socket.on("close", () => {
// 				console.log("socket ended gracefully");
// 				console.log("is destroyed: ", socket.destroyed);
// 				socket.destroyed || socket.destroy();
// 				fs.unlink(pathname, (err) => {
// 					if (err) {
// 					console.error(`Error deleting file: ${err}`);
// 					} else {
// 					console.log('File deleted.');
// 					}
// 				});
// 			});
// 		})
// 		.on('error', () => {
// 			console.log("error on socket: ", pathname)
			
// 		});
// 	}
