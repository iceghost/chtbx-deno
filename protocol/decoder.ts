import { Mutex } from "https://deno.land/x/semaphore@v1.1.2/mod.ts";
import { BufReader } from "std/io/buffer.ts";
import { readerFromStreamReader } from "std/streams/conversion.ts";
import {
	FileOfferMessage,
	FileRequestMessage,
	FileRevokeMessage,
	FileSendMessage,
	HelloMessage,
	Message,
	MessageType,
	SendMessageMessage,
} from "../protocol/message.ts";
import {
	AddFriendRequest,
	AddFriendResponse,
	Friend,
	FriendListRequest,
	FriendListResponse,
	FriendStatus,
	LoginRequest,
	LoginResponse,
	RegisterRequest,
	RegisterResponse,
	Request,
	RequestType,
	Response,
	ResponseType,
} from "../protocol/request_response.ts";

export abstract class Decoder<T> {
	reader: BufReader;
	mutex: Mutex = new Mutex();
	constructor(conn: Deno.Conn) {
		this.reader = BufReader.create(
			readerFromStreamReader(conn.readable.getReader()),
		);
	}

	async byte() {
		const byte = await this.reader.readByte();
		if (byte === null) throw "EOF";
		return byte;
	}

	async twoBytes() {
		return (await this.byte()) * Math.pow(2, 8) + (await this.byte());
	}

	async fourBytes() {
		return (await this.byte()) * Math.pow(2, 24) +
			(await this.byte()) * Math.pow(2, 16) +
			(await this.byte()) * Math.pow(2, 8) + await this.byte();
	}

	async ip() {
		return [
			await this.byte(),
			await this.byte(),
			await this.byte(),
			await this.byte(),
		].join(".");
	}

	// read a string prefixed by its length
	async lenStr() {
		const len = await this.byte();
		const buf = new Uint8Array(len);
		await this.reader.readFull(buf);
		return new TextDecoder().decode(buf);
	}

	// read a null-terminated string
	async nullStr() {
		return (await this.reader.readString("\0"))!.slice(0, -1);
	}

	async decode() {
		const release = await this.mutex.acquire();
		try {
			return await this.decodeBody();
		} finally {
			release();
		}
	}
	protected abstract decodeBody(): Promise<T>;
}

export class RequestDecoder extends Decoder<Request> {
	async decodeBody(): Promise<Request> {
		const type = await this.byte();
		switch (type) {
			case RequestType.LOGIN:
				return this.login();
			case RequestType.REGISTER:
				return this.register();
			case RequestType.FRIEND_LIST:
				return this.friendList();
			case RequestType.ADD_FRIEND:
				return this.addFriend();
		}

		throw new Error(`unreachable type: ${type}`);
	}

	async login(): Promise<LoginRequest> {
		const username = await this.lenStr();
		const password = await this.lenStr();
		const port: number = await this.twoBytes();
		return { type: RequestType.LOGIN, username, password, port };
	}

	async register(): Promise<RegisterRequest> {
		const username = await this.lenStr();
		const password = await this.lenStr();
		return { type: RequestType.REGISTER, username, password };
	}

	async addFriend(): Promise<AddFriendRequest> {
		const username = await this.lenStr();
		return { type: RequestType.ADD_FRIEND, username };
	}

	friendList(): FriendListRequest {
		return { type: RequestType.FRIEND_LIST };
	}
}

export class ResponseDecoder extends Decoder<Response> {
	async decodeBody(): Promise<Response> {
		const type = await this.byte();

		switch (type) {
			case RequestType.LOGIN:
				return this.login();
			case RequestType.REGISTER:
				return this.register();
			case RequestType.FRIEND_LIST:
				return this.friendList();
			case RequestType.ADD_FRIEND:
				return this.addFriend();
		}

		throw new Error(`unreachable type: ${type}`);
	}

	async login(): Promise<LoginResponse> {
		const status = await this.byte();
		return {
			type: ResponseType.LOGIN,
			status,
		};
	}

	async register(): Promise<RegisterResponse> {
		const status = await this.byte();
		return {
			type: ResponseType.REGISTER,
			status,
		};
	}

	async addFriend(): Promise<AddFriendResponse> {
		const status = await this.byte();
		return {
			type: ResponseType.ADD_FRIEND,
			status,
		};
	}

	async friendList(): Promise<FriendListResponse> {
		const len = await this.twoBytes();
		const friends: Friend[] = new Array(len);
		for (let i = 0; i < len; i++) {
			const username = await this.lenStr();
			const type = await this.byte();
			switch (type) {
				case FriendStatus.ONLINE: {
					const ip = await this.ip();
					const port = await this.twoBytes();
					friends[i] = {
						username,
						status: {
							type,
							ip,
							port,
						},
					};
					continue;
				}
				default:
					friends[i] = {
						username,
						status: {
							type,
						},
					};
					continue;
			}
		}
		return { type: ResponseType.FRIEND_LIST, friends };
	}
}

export class MessageDecoder extends Decoder<Message> {
	async decodeBody(): Promise<Message> {
		const type = await this.byte();

		switch (type) {
			case MessageType.SEND_MESSAGE:
				return this.sendMessage();
			case MessageType.HELLO:
				return this.hello();
			case MessageType.FILE_OFFER:
				return this.fileOffer();
			case MessageType.FILE_REQUEST:
				return this.fileRequest();
			case MessageType.FILE_SEND:
				return this.fileSend();
			case MessageType.FILE_REVOKE:
				return this.fileRevoke();
			default:
				throw new Error(`unreachable type: ${type}`);
		}
	}
	async sendMessage(): Promise<SendMessageMessage> {
		const content = await this.nullStr();
		return { type: MessageType.SEND_MESSAGE, content };
	}
	async hello(): Promise<HelloMessage> {
		const username = await this.lenStr();
		return { type: MessageType.HELLO, username };
	}

	async fileOffer(): Promise<FileOfferMessage> {
		const name = await this.nullStr();
		const size = await this.fourBytes();
		return {
			type: MessageType.FILE_OFFER,
			name,
			size,
		};
	}

	fileRevoke(): FileRevokeMessage {
		return { type: MessageType.FILE_REVOKE };
	}

	fileRequest(): FileRequestMessage {
		return { type: MessageType.FILE_REQUEST };
	}

	async fileSend(): Promise<FileSendMessage> {
		const size = await this.fourBytes();
		const chunk = new Uint8Array(size);
		const ok = await this.reader.readFull(chunk);
		if (!ok) throw "EOF";
		return {
			type: MessageType.FILE_SEND,
			chunk,
		};
	}
}
