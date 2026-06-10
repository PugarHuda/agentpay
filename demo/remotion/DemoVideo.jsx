import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

const FONT = "'Archivo Black','Arial Black',Arial,sans-serif";
const BODY = "'Space Grotesk',Arial,sans-serif";
const INK = "#0b0b0b";
const PAPER = "#f4efe1";
const BORDER = `6px solid ${INK}`;
const SHADOW = `12px 12px 0 ${INK}`;

function Header({ brand }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 28,
        left: 40,
        right: 40,
        height: 72,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            background: brand.accent,
            border: BORDER,
            boxShadow: `5px 5px 0 ${INK}`,
          }}
        />
        <div>
          <div style={{ fontFamily: FONT, fontSize: 36, color: INK, lineHeight: 1 }}>
            {brand.title}
          </div>
          <div style={{ fontFamily: BODY, fontSize: 18, color: "#3a3a3a", marginTop: 4 }}>
            {brand.tagline}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: INK,
          color: "#fff",
          fontFamily: BODY,
          fontWeight: 700,
          fontSize: 18,
          padding: "10px 18px",
          border: BORDER,
          borderColor: INK,
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#39d353" }} />
        LIVE on LiteForge · Chain 4441
      </div>
    </div>
  );
}

function Caption({ text, accent, frame }) {
  const appear = spring({ frame, fps: 30, config: { damping: 200 }, durationInFrames: 12 });
  const y = interpolate(appear, [0, 1], [40, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        right: 40,
        bottom: 32,
        transform: `translateY(${y}px)`,
        opacity: appear,
        background: PAPER,
        border: BORDER,
        boxShadow: SHADOW,
        padding: "20px 26px",
        display: "flex",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div style={{ width: 14, alignSelf: "stretch", background: accent, border: BORDER, flexShrink: 0 }} />
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 27, color: INK, lineHeight: 1.3 }}>
        {text}
      </div>
    </div>
  );
}

function Scene({ scene, brand }) {
  const frame = useCurrentFrame();
  const enter = spring({ frame, fps: 30, config: { damping: 200 }, durationInFrames: 10 });
  const scale = interpolate(enter, [0, 1], [0.985, 1]);
  return (
    <AbsoluteFill style={{ background: brand.accent }}>
      {/* halftone-ish paper backdrop */}
      <AbsoluteFill style={{ background: PAPER, opacity: 0.0 }} />
      <Header brand={brand} />

      {/* framed live screen-capture */}
      <div
        style={{
          position: "absolute",
          top: 120,
          left: 40,
          width: 1200,
          height: 468,
          border: BORDER,
          boxShadow: SHADOW,
          background: "#fff",
          overflow: "hidden",
          transform: `scale(${scale})`,
          transformOrigin: "center top",
        }}
      >
        {scene.clip ? (
          <OffthreadVideo
            src={staticFile(scene.clip)}
            muted
            loop
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
          />
        ) : (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 40 }}>
            {brand.url}
          </AbsoluteFill>
        )}
      </div>

      <Caption text={scene.caption} accent={brand.accent} frame={frame} />

      {scene.audio && <Audio src={staticFile(scene.audio)} />}
    </AbsoluteFill>
  );
}

export const DemoVideo = ({ data, brand }) => {
  const { fps } = useVideoConfig();
  let from = 0;
  return (
    <AbsoluteFill style={{ background: brand.accent }}>
      {data.scenes.map((scene) => {
        const seq = (
          <Sequence key={scene.id} from={from} durationInFrames={scene.durationInFrames}>
            <Scene scene={scene} brand={brand} />
          </Sequence>
        );
        from += scene.durationInFrames;
        return seq;
      })}
    </AbsoluteFill>
  );
};
