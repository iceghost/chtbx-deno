import "dotenv/load";
import { findAccount, setIP } from "../db.ts";
import {
	LoginRequest,
	LoginStatus,
	RequestDecoder,
	ResponseEncoder,
} from "../message.ts";

class Handler {
	ip: string;
	id: number | null;
	decoder: RequestDecoder;
	encoder: ResponseEncoder;

	constructor(conn: Deno.Conn) {
		if (conn.remoteAddr.transport != "tcp") throw "unreachable";
		this.ip = `${conn.remoteAddr.hostname}:${conn.remoteAddr.port}`;
		this.id = null;
		this.decoder = new RequestDecoder(conn);
		this.encoder = new ResponseEncoder(conn);
	}

	async handle() {
		try {
			while (true) {
				const request = await this.decoder.decode();
				switch (request.type) {
					case "login":
						this.login(request);
						break;
				}
			}
		} catch (e) {
			console.error(e.message);

			// if is logged in
			if (this.id !== null) {
				setIP.first({ id: this.id, ip: null });
			}
		}
	}

	login(request: LoginRequest) {
		console.log(
			"user",
			request.username,
			"log in with",
			request.password,
		);
		const account = findAccount.firstEntry({
			username: request.username,
		});
		if (!account) {
			console.log("username does not exist");
			this.encoder.login(LoginStatus.USERNAME_NOT_EXIST);
			return;
		}
		if (account.password != request.password) {
			console.log("password mismatch", account.password);
			this.encoder.login(LoginStatus.WRONG_PASSWORD);
			return;
		}
		if (account.ip !== null) {
			console.log("already logged in");
			this.encoder.login(LoginStatus.ALREADY_LOGGED_IN);
			return;
		}
		this.id = account.id;
		setIP.first({ id: this.id, ip: this.ip });
		this.encoder.login(LoginStatus.OK);
	}
}

const listener = Deno.listen({
	port: parseInt(Deno.env.get("SERVER_PORT")!),
	transport: "tcp",
});

for await (const conn of listener) {
	const handler = new Handler(conn);
	handler.handle();
}
