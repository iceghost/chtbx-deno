import { BufWriter } from "std/io/buffer.ts";
import { writerFromStreamWriter } from "std/streams/conversion.ts";
import {
	HelloMessage,
	Message,
	MessageType,
	SendMessageMessage,
} from "../protocol/message.ts";
import {
	FriendListRequest,
	FriendListResponse,
	LoginRequest,
	LoginResponse,
	RegisterRequest,
	RegisterResponse,
	Request,
	RequestType,
	Response,
	ResponseType,
} from "../protocol/request_response.ts";

export abstract class Encoder<T> {
	writer: BufWriter;
	constructor(conn: Deno.Conn) {
		this.writer = BufWriter.create(
			writerFromStreamWriter(conn.writable.getWriter()),
		);
	}

	ip(ip: string) {
		const parts = ip.split(".").map(Number);
		if (parts.some((part) => isNaN(part) || part > 255)) {
			throw new Error(`invalid ip format: ${ip}`);
		}
		this.writer.write(new Uint8Array(parts));
	}

	twoBytes(m: number) {
		if (m >= Math.pow(2, 16)) {
			throw Error(`num bigger than 2 bytes: ${m}`);
		}
		this.writer.write(
			new Uint8Array([
				Math.trunc(m / Math.pow(2, 8)),
				m % Math.pow(2, 8),
			]),
		);
	}

	lengthStr(s: string) {
		if (s.length > 255) {
			throw Error(`string has more than 255 byte: ${s}`);
		}
		this.writer.write(
			new Uint8Array([s.length, ...new TextEncoder().encode(s)]),
		);
	}

	nullStr(s: string) {
		this.writer.write(
			new Uint8Array([...new TextEncoder().encode(s), 0]),
		);
	}

	abstract encode(t: T): void;
}

export class RequestEncoder extends Encoder<Request> {
	encode(req: Request): void {
		if (req.type === RequestType.LOGIN) {
			return this.login(req);
		}
		if (req.type === RequestType.REGISTER) {
			return this.register(req);
		}
		if (req.type === RequestType.FRIEND_LIST) {
			return this.friendList(req);
		}
	}
	login(req: LoginRequest) {
		this.writer.write(new Uint8Array([RequestType.LOGIN]));
		this.lengthStr(req.username);
		this.lengthStr(req.password);
		this.ip(req.ip);
		this.twoBytes(req.port);
		this.writer.flush();
	}
	register(req: RegisterRequest) {
		this.writer.write(new Uint8Array([RequestType.REGISTER]));
		this.lengthStr(req.username);
		this.lengthStr(req.password);
		this.writer.flush();
	}
	friendList(_: FriendListRequest) {
		this.writer.write(new Uint8Array([RequestType.FRIEND_LIST]));
		this.writer.flush();
	}
}

export class ResponseEncoder extends Encoder<Response> {
	encode(res: Response): void {
		if (res.type === ResponseType.LOGIN) {
			return this.login(res);
		}
		if (res.type === ResponseType.REGISTER) {
			return this.register(res);
		}
		if (res.type === ResponseType.FRIEND_LIST) {
			return this.friendList(res);
		}
	}
	login(res: LoginResponse) {
		this.writer.write(new Uint8Array([ResponseType.LOGIN, res.status]));
		this.writer.flush();
	}
	register(res: RegisterResponse) {
		this.writer.write(new Uint8Array([ResponseType.REGISTER, res.status]));
		this.writer.flush();
	}
	friendList(res: FriendListResponse) {
		this.writer.write(new Uint8Array([ResponseType.FRIEND_LIST]));
		this.twoBytes(res.friends.length);
		for (const friend of res.friends) {
			this.lengthStr(friend.username);
			this.ip(friend.ip);
			this.twoBytes(friend.port);
		}
		this.writer.flush();
	}
}

export class MessageEncoder extends Encoder<Message> {
	encode(msg: Message): void {
		if (msg.type === MessageType.SEND_MESSAGE) {
			return this.sendMessage(msg);
		}
		if (msg.type === MessageType.HELLO) {
			return this.hello(msg);
		}
		throw "unimplemented";
	}
	sendMessage(msg: SendMessageMessage) {
		this.writer.write(
			new Uint8Array([
				MessageType.SEND_MESSAGE,
			]),
		);
		this.nullStr(msg.content);
		this.writer.flush();
	}
	hello(msg: HelloMessage) {
		this.writer.write(new Uint8Array([MessageType.HELLO]));
		this.lengthStr(msg.username);
		this.writer.flush();
	}
}
