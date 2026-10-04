"use client";

import { RefObject, useCallback, useEffect, useState } from "react";
import { supportsPictureInPicture } from "@/lib/mobile-media";

export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>, sourceKey: unknown) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    setSupported(supportsPictureInPicture(document, video));
    if (!video) {
      setActive(false);
      return;
    }

    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    setActive(document.pictureInPictureElement === video);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [sourceKey, videoRef]);

  const toggle = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !supportsPictureInPicture(document, video)) return;
    try {
      if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // PiP can be refused by the browser or by the current playback state.
    }
  }, [videoRef]);

  return { supported, active, toggle };
}
