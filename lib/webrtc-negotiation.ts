export interface NegotiationFlags {
  polite: boolean;
  makingOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
}

export interface OfferDecision {
  readyForOffer: boolean;
  offerCollision: boolean;
  ignoreOffer: boolean;
}

export function decideIncomingDescription(
  flags: NegotiationFlags,
  signalingState: RTCSignalingState,
  descriptionType: RTCSdpType,
): OfferDecision {
  const readyForOffer = !flags.makingOffer && (signalingState === "stable" || flags.isSettingRemoteAnswerPending);
  const offerCollision = descriptionType === "offer" && !readyForOffer;
  return { readyForOffer, offerCollision, ignoreOffer: !flags.polite && offerCollision };
}

export function isPolitePeer(localSocketId: string, remoteSocketId: string) {
  return localSocketId.localeCompare(remoteSocketId) > 0;
}

export class IceCandidateQueue<T> {
  private readonly candidates: T[] = [];

  enqueue(candidate: T) { this.candidates.push(candidate); }
  get size() { return this.candidates.length; }
  clear() { this.candidates.length = 0; }

  async flush(add: (candidate: T) => Promise<void>) {
    const pending = this.candidates.splice(0);
    for (let index = 0; index < pending.length; index += 1) {
      try {
        await add(pending[index]);
      } catch (error) {
        this.candidates.unshift(...pending.slice(index));
        throw error;
      }
    }
  }
}
