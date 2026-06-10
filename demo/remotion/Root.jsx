import React from "react";
import { Composition } from "remotion";
import { DemoVideo } from "./DemoVideo";
import gw from "./scenes.grailwatch.json";
import ap from "./scenes.agentpay.json";

const BRANDS = {
  grailwatch: {
    title: "GrailWatch",
    accent: "#b9ff4d",
    tagline: "Proof-of-Reserves for zkLTC",
    url: "grailwatch-mauve.vercel.app",
  },
  agentpay: {
    title: "AgentPay",
    accent: "#5b8def",
    tagline: "AI agents earning hard money",
    url: "agentpay-xi-ten.vercel.app",
  },
};

export const RemotionRoot = () => (
  <>
    <Composition
      id="GrailWatch"
      component={DemoVideo}
      durationInFrames={gw.totalFrames}
      fps={gw.fps}
      width={gw.width}
      height={gw.height}
      defaultProps={{ data: gw, brand: BRANDS.grailwatch }}
    />
    <Composition
      id="AgentPay"
      component={DemoVideo}
      durationInFrames={ap.totalFrames}
      fps={ap.fps}
      width={ap.width}
      height={ap.height}
      defaultProps={{ data: ap, brand: BRANDS.agentpay }}
    />
  </>
);
