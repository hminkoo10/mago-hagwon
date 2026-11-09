import { expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientIp } from "./node-adapter";
it("프록시 미신뢰 시 소켓만·신뢰 시 XFF 맨 오른쪽", () => {
 const req = {headers:{"x-forwarded-for":"forged, 192.0.2.1, 192.0.2.2"},socket:{remoteAddress:"127.0.0.1"}} as unknown as IncomingMessage;
 expect(clientIp(req,false)).toBe("127.0.0.1");
 expect(clientIp(req,true)).toBe("192.0.2.2");
 req.headers["x-forwarded-for"]=["forged","192.0.2.3"];
 expect(clientIp(req,true)).toBe("192.0.2.3");
 delete req.headers["x-forwarded-for"];
 expect(clientIp(req,true)).toBe("127.0.0.1");
});
