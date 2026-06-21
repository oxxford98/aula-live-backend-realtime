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

type PeerMediaState = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
};

type RoomPeer = {
  id: string;
  uid: string;
  name: string;
  role: "admin" | "participant";
};

type RoomState = {
  peers: Map<string, RoomPeer>;
  mediaByPeerId: Map<string, PeerMediaState>;
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
const roomStates = new Map<string, RoomState>();
const socketRoomIndex = new Map<string, string>();

const getDefaultMediaState = (): PeerMediaState => ({
  audioEnabled: false,
  videoEnabled: false,
  screenSharing: false,
});

const getOrCreateRoomState = (roomId: string): RoomState => {
  const current = roomStates.get(roomId);
  if (current) {
    return current;
  }

  const next: RoomState = {
    peers: new Map(),
    mediaByPeerId: new Map(),
  };
  roomStates.set(roomId, next);
  return next;
};

const emitRoomParticipants = (roomId: string): void => {
  const roomState = roomStates.get(roomId);
  if (!roomState) {
    io.to(roomId).emit("room_participants", []);
    return;
  }

  const participants = Array.from(roomState.peers.values()).map((peer) => ({
    id: peer.id,
    name: peer.name,
    role: peer.role,
  }));

  io.to(roomId).emit("room_participants", participants);
};

const leaveTrackedRoom = (socketId: string): void => {
  const roomId = socketRoomIndex.get(socketId);
  if (!roomId) {
    return;
  }

  socketRoomIndex.delete(socketId);
  const roomState = roomStates.get(roomId);
  if (!roomState) {
    return;
  }

  roomState.peers.delete(socketId);
  roomState.mediaByPeerId.delete(socketId);
  io.to(roomId).emit("peer_left", { peerId: socketId });

  if (roomState.peers.size === 0) {
    roomStates.delete(roomId);
    return;
  }

  emitRoomParticipants(roomId);
};

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
      leaveTrackedRoom(socket.id);

      const roomId = String(rawRoomId || "").trim().toUpperCase();
      if (!roomId) throw new Error("roomId required");

      const roomDoc = await db.collection("rooms").doc(roomId).get();
      if (!roomDoc.exists) {
        if (ack) ack({ ok: false, error: "Room not found" });
        return;
      }

      socket.join(roomId);
      socketRoomIndex.set(socket.id, roomId);

      const creatorUid = String(roomDoc.data()?.creatorUid || "");
      const roomState = getOrCreateRoomState(roomId);

      for (const [peerSocketId, existingPeer] of roomState.peers.entries()) {
        if (existingPeer.uid !== auth.uid || peerSocketId === socket.id) {
          continue;
        }

        roomState.peers.delete(peerSocketId);
        roomState.mediaByPeerId.delete(peerSocketId);
        socketRoomIndex.delete(peerSocketId);
        io.to(roomId).emit("peer_left", { peerId: peerSocketId });
        io.sockets.sockets.get(peerSocketId)?.disconnect(true);
      }

      const peer: RoomPeer = {
        id: socket.id,
        uid: auth.uid,
        name: auth.name || auth.email || "Participante",
        role: creatorUid && creatorUid === auth.uid ? "admin" : "participant",
      };
      const existingPeers = Array.from(roomState.peers.values());
      const existingMediaEntries = Array.from(roomState.mediaByPeerId.entries());
      roomState.peers.set(peer.id, peer);
      roomState.mediaByPeerId.set(peer.id, getDefaultMediaState());

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

      socket.to(roomId).emit("peer_joined", {
        peer,
        mediaState: getDefaultMediaState(),
      });
      emitRoomParticipants(roomId);

      if (ack) {
        ack({
          ok: true,
          messages,
          selfPeerId: socket.id,
          peers: existingPeers,
          mediaStates: existingMediaEntries.map(([peerId, state]) => ({ peerId, ...state })),
          participants: Array.from(roomState.peers.values()).map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
          })),
        });
      }
    } catch (e) {
      if (ack) ack({ ok: false, error: (e as Error).message });
    }
  });

  socket.on("leave_room", (rawRoomId: string) => {
    const roomId = String(rawRoomId || "").trim().toUpperCase();
    if (roomId) {
      socket.leave(roomId);
      leaveTrackedRoom(socket.id);
    }
  });

  socket.on("webrtc_offer", (payload: { roomId: string; toPeerId: string; sdp: Record<string, unknown> }) => {
    const roomId = String(payload?.roomId || "").trim().toUpperCase();
    const toPeerId = String(payload?.toPeerId || "").trim();
    if (!roomId || !toPeerId || !payload?.sdp) {
      return;
    }

    io.to(toPeerId).emit("webrtc_offer", {
      roomId,
      fromPeerId: socket.id,
      sdp: payload.sdp,
    });
  });

  socket.on("webrtc_answer", (payload: { roomId: string; toPeerId: string; sdp: Record<string, unknown> }) => {
    const roomId = String(payload?.roomId || "").trim().toUpperCase();
    const toPeerId = String(payload?.toPeerId || "").trim();
    if (!roomId || !toPeerId || !payload?.sdp) {
      return;
    }

    io.to(toPeerId).emit("webrtc_answer", {
      roomId,
      fromPeerId: socket.id,
      sdp: payload.sdp,
    });
  });

  socket.on("webrtc_ice_candidate", (payload: { roomId: string; toPeerId: string; candidate: Record<string, unknown> }) => {
    const roomId = String(payload?.roomId || "").trim().toUpperCase();
    const toPeerId = String(payload?.toPeerId || "").trim();
    if (!roomId || !toPeerId || !payload?.candidate) {
      return;
    }

    io.to(toPeerId).emit("webrtc_ice_candidate", {
      roomId,
      fromPeerId: socket.id,
      candidate: payload.candidate,
    });
  });

  socket.on("media_state", (payload: { roomId: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => {
    const roomId = String(payload?.roomId || "").trim().toUpperCase();
    const trackedRoomId = socketRoomIndex.get(socket.id);
    if (!roomId || trackedRoomId !== roomId) {
      return;
    }

    const roomState = roomStates.get(roomId);
    if (!roomState) {
      return;
    }

    const nextState: PeerMediaState = {
      audioEnabled: Boolean(payload.audioEnabled),
      videoEnabled: Boolean(payload.videoEnabled),
      screenSharing: Boolean(payload.screenSharing),
    };

    roomState.mediaByPeerId.set(socket.id, nextState);
    io.to(roomId).emit("media_state_changed", {
      peerId: socket.id,
      ...nextState,
    });
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

  socket.on("disconnect", () => {
    leaveTrackedRoom(socket.id);
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
server.listen(PORT, () => console.log(`Socket server listening on ${PORT}`));