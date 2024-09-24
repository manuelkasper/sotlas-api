const express = require('express');
const EventEmitter = require('events');
const keyzipper = require('./keyzipper')

const PING_INTERVAL = 30000;
const STATS_INTERVAL = 60000;

class WebSocketManager extends EventEmitter {
	constructor() {
		super();
		this.webSocketClients = new Set();
		this.router = express.Router();

		setInterval(() => {
			console.log("Number of clients: " + this.webSocketClients.size);
		}, STATS_INTERVAL);

		this.router.ws('/', (ws, req) => {
			//console.log('WebSocket client connected');
			ws.isAlive = true;
			this.webSocketClients.add(ws);

			this.emit('connect', ws);

			ws.on('message', (data) => {
				try {
					let message = JSON.parse(data);
					this.emit('message', ws, message);
				} catch (e) {}
			});
			ws.on('pong', () => {
				ws.isAlive = true;
			});
			ws.on('close', () => {
				//console.log("WebSocket closed");
				clearInterval(ws.pingInterval);
				this.webSocketClients.delete(ws);
			});
			ws.on('error', (error) => {
				console.log("WebSocket error: " + error);
				clearInterval(ws.pingInterval);
				this.webSocketClients.delete(ws);
			});

			ws.pingInterval = setInterval(() => {
				if (!ws.isAlive) {
					//console.log("WebSocket ping timeout");
					ws.terminate();
					return;
				}
				ws.isAlive = false;
				try {
					ws.ping();
				} catch (e) {
					console.error(e);
				}
			}, PING_INTERVAL);
		});
	}

	broadcast(message, filter) {
		let str = JSON.stringify(keyzipper.compressKeys(message));
		for (const ws of this.webSocketClients) {
			if (filter && !filter(ws)) {
				continue;
			}

			try {
				ws.send(str);
			} catch (e) {
				console.error(e);
			}
		}
	}

	unicast(message, ws) {
		try {
			ws.send(JSON.stringify(keyzipper.compressKeys(message)));
		} catch (e) {
			console.error(e);
		}
	}

	numberOfClients() {
		return this.webSocketClients.size;
	}
}

let wsManager = new WebSocketManager();

// This is a singleton for ease of use
module.exports = wsManager;
