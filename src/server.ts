import express from "express";
import http from "http";
import { Server } from "socket.io";
import admin, { db } from './config/firebase.js';
import cors from "cors";
import { resolve } from "node:path";


type AuthPayload = { uid: string; name?: string | null; email?: string | null };

type Message = {
  id?: string;
  text: string;
  userUid: string;
  displayName?: string | null;
  createdAt?: string | null;
};

const app = express();
app.use(cors());
app.use("/docs", express.static(resolve(process.cwd(), "public/docs")));

app.get("/docs", (req, res) => {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:4000";
  const rawProtocol = req.get("x-forwarded-proto") || req.protocol || "http";
  const protocol = rawProtocol.split(",")[0]?.trim() || "http";
  const specUrl = `${protocol}://${host}/docs/asyncapi.yaml`;
  const studioUrl = `https://studio.asyncapi.com/?url=${encodeURIComponent(specUrl)}`;
  res.redirect(studioUrl);
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "aula-live-backend-realtime" });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) throw new Error("No token provided");
    const decoded = await admin.auth().verifyIdToken(token);
    (socket as any).auth = { uid: decoded.uid, name: decoded.name || null, email: decoded.email || null } as AuthPayload;
    return next();
  } catch {
    return next(new Error("Authentication error"));
  }
});

const MESSAGES_PAGE = 100;

io.on("connection", (socket) => {
  const auth: AuthPayload = (socket as any).auth;

  socket.on("join_room", async (rawRoomId: string, ack?: (res: any) => void) => {
    try {
      const roomId = String(rawRoomId || "").trim().toUpperCase();
      if (!roomId) throw new Error("roomId required");

      const roomDoc = await db.collection("rooms").doc(roomId).get();
      if (!roomDoc.exists) {
        if (ack) ack({ ok: false, error: "Room not found" });
        return;
      }

      socket.join(roomId);

      const snap = await db.collection("rooms").doc(roomId).collection("messages")
        .orderBy("createdAt", "desc").limit(MESSAGES_PAGE).get();

      const messages: Message[] = snap.docs.map(d => {
        const data = d.data();
        const ts = data.createdAt;
        const createdAt = ts?.toDate ? ts.toDate().toISOString() : null;
        return { id: d.id, text: String(data.text || ""), userUid: String(data.userUid || ""), displayName: data.displayName || null, createdAt };
      }).reverse();

      console.info("[room_joined]", {
        roomId,
        uid: auth.uid,
        user: auth.name || auth.email || null,
        socketId: socket.id,
        at: new Date().toISOString(),
      });

      if (ack) ack({ ok: true, messages });
    } catch (e) {
      if (ack) ack({ ok: false, error: (e as Error).message });
    }
  });

  socket.on("leave_room", (rawRoomId: string) => {
    const roomId = String(rawRoomId || "").trim().toUpperCase();
    if (roomId) socket.leave(roomId);
  });

  socket.on("message", async (payload: { roomId: string; text: string }, ack?: (res: any) => void) => {
    try {
      const roomId = String(payload.roomId || "").trim().toUpperCase();
      const text = String(payload.text || "").trim();
      if (!roomId || !text) throw new Error("roomId and text are required");
      if (text.length > 2000) throw new Error("Message too long");

      const roomDoc = await db.collection("rooms").doc(roomId).get();
      if (!roomDoc.exists) throw new Error("Room not found");

      const record = { text, userUid: auth.uid, displayName: auth.name || auth.email || null, createdAt: admin.firestore.FieldValue.serverTimestamp() };
      const ref = await db.collection("rooms").doc(roomId).collection("messages").add(record);

      const now = new Date().toISOString();
      const outgoing: Message = { id: ref.id, text, userUid: auth.uid, displayName: record.displayName, createdAt: now };

      io.to(roomId).emit("message", outgoing);
      if (ack) ack({ ok: true });
    } catch (e) {
      if (ack) ack({ ok: false, error: (e as Error).message });
    }
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
server.listen(PORT, () => console.log(`Socket server listening on ${PORT}`));