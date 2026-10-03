import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createClients, createRoom, disconnectSocket, getInvitation, joinRoom, participantSnapshot, reconnectSocket } from "./helpers";

test("Host transfers the local MP4 to two Guests over P2P without external ICE", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const clients = await createClients(browser, baseURL!, ["Host", "Guest A", "Guest B"]);
  const [host, guestA, guestB] = clients.clients;

  try {
    for (const client of clients.clients) {
      await client.page.addInitScript(() => {
        const target = window as Window & { __e2eRtc?: Array<Record<string, unknown>>; __e2eSignals?: string[] };
        target.__e2eRtc = [];
        target.__e2eSignals = [];
        const NativePeer = window.RTCPeerConnection;
        class TracedPeer extends NativePeer {
          constructor(configuration?: RTCConfiguration) {
            super(configuration);
            const record: Record<string, unknown> = { configuration, connection: this.connectionState, ice: this.iceConnectionState, signaling: this.signalingState, candidates: [], channels: [] };
            target.__e2eRtc!.push(record);
            const update = () => {
              record.connection = this.connectionState;
              record.ice = this.iceConnectionState;
              record.signaling = this.signalingState;
            };
            this.addEventListener("connectionstatechange", update);
            this.addEventListener("iceconnectionstatechange", update);
            this.addEventListener("signalingstatechange", update);
            this.addEventListener("icecandidate", (event) => (record.candidates as unknown[]).push(event.candidate?.candidate ?? "complete"));
            this.addEventListener("datachannel", (event) => (record.channels as unknown[]).push({ label: event.channel.label, state: event.channel.readyState }));
            const createDataChannel = this.createDataChannel.bind(this);
            this.createDataChannel = (label, options) => {
              const channel = createDataChannel(label, options);
              (record.channels as unknown[]).push({ label: channel.label, state: channel.readyState });
              channel.addEventListener("open", () => (record.channels as Array<{ label: string; state: string }>).forEach((entry) => { if (entry.label === label) entry.state = channel.readyState; }));
              return channel;
            };
          }
        }
        Object.defineProperty(window, "RTCPeerConnection", { configurable: true, writable: true, value: TracedPeer });
      });
    }
    await createRoom(host.page, host.name);
    const invitation = await getInvitation(host.page);
    await joinRoom(guestA.page, invitation!, guestA.name);
    await joinRoom(guestB.page, invitation!, guestB.name);
    for (const client of clients.clients) {
      await client.page.evaluate(() => {
        const target = window as Window & { __watchTogetherSocket?: { onAny?: (fn: (event: string) => void) => void; onAnyOutgoing?: (fn: (event: string) => void) => void }; __e2eSignals?: string[] };
        target.__watchTogetherSocket?.onAny?.((event) => target.__e2eSignals?.push(`in:${event}`));
        target.__watchTogetherSocket?.onAnyOutgoing?.((event) => target.__e2eSignals?.push(`out:${event}`));
      });
    }

    await host.page.getByRole("button", { name: "P2P фильм с компьютера" }).click();
    await host.page.getByLabel("Выбрать P2P-фильм").setInputFiles(resolve(process.cwd(), "tests/e2e/fixtures/e2e-small.mp4"));
    await expect(host.page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");

    const hostP2PState = host.page.getByTestId("p2p-state");
    await expect.poll(async () => host.page.evaluate(() => (window as Window & { __e2eRtc?: unknown[] }).__e2eRtc?.length ?? 0), { timeout: 10_000 }).toBeGreaterThan(0);
    const currentP2PDiagnostics = async () => Promise.all(clients.clients.map((client) => client.page.evaluate(() => {
      const target = window as Window & {
        __e2eRtc?: Array<{ connection?: string; ice?: string; signaling?: string; channels?: Array<{ label: string; state: string }> }>;
        __e2eSignals?: string[];
      };
      return {
        peers: target.__e2eRtc?.map(({ connection, ice, signaling, channels }) => ({ connection, ice, signaling, channels })),
        signals: target.__e2eSignals,
        p2pState: document.querySelector('[data-testid="p2p-state"]')?.getAttribute("data-state"),
      };
    })));
    await expect.poll(async () => JSON.stringify(await currentP2PDiagnostics()), { timeout: 15_000 }).toContain("movie:");
    const signals = (await currentP2PDiagnostics()).flatMap((client) => client.signals ?? []);
    expect(signals).toContain("out:movie:offer");
    expect(signals).toContain("in:movie:answer");
    await expect.poll(async () => host.page.evaluate(() => {
      const peers = (window as Window & { __e2eRtc?: Array<{ connection?: string }> }).__e2eRtc ?? [];
      return peers.filter((peer) => peer.connection === "connected").length;
    }), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect(hostP2PState).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    for (const guest of [guestA, guestB]) {
      const state = guest.page.getByTestId("p2p-state");
      const bytes = guest.page.getByTestId("p2p-transferred-bytes");
      await expect.poll(async () => Number(await bytes.getAttribute("data-bytes")), { timeout: 60_000 }).toBeGreaterThan(0);
      await expect(state).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
      await expect(guest.page.getByTestId("video-state")).toHaveAttribute("data-revision", "1");
    }

    const diagnostics = await currentP2PDiagnostics();
    expect(diagnostics[0]?.peers?.filter((peer) => peer.connection === "connected")).toHaveLength(2);
    for (const client of diagnostics) {
      const connectedPeers = client.peers?.filter((peer) => peer.connection === "connected") ?? [];
      expect(connectedPeers.length).toBeGreaterThan(0);
      for (const peer of connectedPeers) {
        expect(peer.channels).toEqual(expect.arrayContaining([
          expect.objectContaining({ label: "movie-control", state: "open" }),
          expect.objectContaining({ label: "movie-data", state: "open" }),
        ]));
      }
    }

    const guestAId = (await participantSnapshot(guestA.page)).find((person) => person.name === guestA.name)?.id;
    const guestABytes = Number(await guestA.page.getByTestId("p2p-transferred-bytes").getAttribute("data-bytes"));
    const guestAPeerCount = diagnostics[1]?.peers?.length ?? 0;
    const hostPeerCount = diagnostics[0]?.peers?.length ?? 0;
    await disconnectSocket(guestA.page);
    await reconnectSocket(guestA.page);
    await expect.poll(async () => {
      const people = await participantSnapshot(host.page);
      return people.find((person) => person.name === guestA.name);
    }, { timeout: 15_000 }).toEqual(expect.objectContaining({ id: guestAId, connected: true }));
    await expect(host.page.getByTestId("participant-count")).toHaveText("3");
    await expect.poll(async () => {
      const current = await currentP2PDiagnostics();
      return current[1]?.peers?.slice(guestAPeerCount).some((peer) => peer.connection === "connected") ?? false;
    }, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => {
      const current = await currentP2PDiagnostics();
      return current[0]?.peers?.slice(hostPeerCount).some((peer) => peer.connection === "connected") ?? false;
    }, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => Number(await guestA.page.getByTestId("p2p-transferred-bytes").getAttribute("data-bytes")), { timeout: 30_000 }).toBeGreaterThan(guestABytes);
    const guestAAfterReconnect = (await participantSnapshot(guestA.page)).filter((person) => person.id === guestAId);
    expect(guestAAfterReconnect).toHaveLength(1);
    expect(guestAAfterReconnect[0]).toMatchObject({ connected: true, isHost: false });

    await clients.assertNoBrowserErrors();
  } finally {
    await clients.close();
  }
});
