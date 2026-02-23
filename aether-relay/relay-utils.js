const DEFAULT_MAX_DESTINATIONS = 4;
const DEFAULT_SOFT_QUEUE_BYTES = 2 * 1024 * 1024;
const DEFAULT_HARD_QUEUE_BYTES = 8 * 1024 * 1024;
const DEFAULT_SUSTAINED_MS = 5000;

function isRtmpUrl(value) {
  return /^rtmps?:\/\//i.test(String(value || "").trim());
}

function buildRtmpUrl(base, streamKey) {
  return `${String(base || "").replace(/\/$/, "")}/${String(streamKey || "").trim()}`;
}

function normalizeDestinations({
  streamKey,
  destinations,
  primaryBase,
  maxDestinations = DEFAULT_MAX_DESTINATIONS,
}) {
  const cleanKey = String(streamKey || "").trim();
  if (!cleanKey) return [];

  const list = [];
  const primary = isRtmpUrl(cleanKey) ? cleanKey : buildRtmpUrl(primaryBase, cleanKey);
  list.push(primary);

  if (Array.isArray(destinations)) {
    for (const raw of destinations) {
      const candidate = String(raw || "").trim();
      if (!isRtmpUrl(candidate)) continue;
      list.push(candidate);
    }
  }

  const deduped = [];
  const seen = new Set();
  const limit = Math.max(1, Number(maxDestinations) || DEFAULT_MAX_DESTINATIONS);

  for (const target of list) {
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function buildTeeMuxerTarget(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("outputs_required_for_tee");
  }
  return outputs
    .map((target) => `[f=flv:onfail=ignore:use_fifo=1]${target}`)
    .join("|");
}

function buildFfmpegArgs({
  outputs,
  width = 1280,
  height = 720,
  fps = 30,
  vBitrateKbps = 2500,
  aBitrateKbps = 128,
  preset = "ultrafast",
}) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("outputs_required");
  }

  const safeFps = Math.max(1, Number(fps) || 30);
  const safeVBps = Math.max(300, Number(vBitrateKbps) || 2500);
  const safeABps = Math.max(32, Number(aBitrateKbps) || 128);
  const keyframeInterval = safeFps * 2;
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

  const args = [
    "-loglevel", "warning",
    "-fflags", "+genpts",
    "-f", "webm",
    "-i", "pipe:0",
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", String(preset || "ultrafast"),
    "-tune", "zerolatency",
    "-profile:v", "high",
    "-level", "4.1",
    "-pix_fmt", "yuv420p",
    "-vf", scaleFilter,
    "-r", String(safeFps),
    "-g", String(keyframeInterval),
    "-keyint_min", String(keyframeInterval),
    "-sc_threshold", "0",
    "-b:v", `${safeVBps}k`,
    "-maxrate", `${safeVBps}k`,
    "-minrate", `${safeVBps}k`,
    "-bufsize", `${safeVBps * 2}k`,
    "-c:a", "aac",
    "-b:a", `${safeABps}k`,
    "-ar", "44100",
    "-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0",
  ];

  if (outputs.length === 1) {
    args.push("-f", "flv", outputs[0]);
  } else {
    args.push("-f", "tee", buildTeeMuxerTarget(outputs));
  }

  return args;
}

function nextRestartDelayMs(attempt, baseMs = 1500, maxMs = 12000) {
  const safeAttempt = Math.max(0, Number(attempt) || 0);
  const safeBase = Math.max(200, Number(baseMs) || 1500);
  const safeMax = Math.max(safeBase, Number(maxMs) || 12000);
  return Math.min(safeMax, Math.round(safeBase * Math.pow(2, safeAttempt)));
}

function queueCongestionLevel(
  queueBytes,
  softThresholdBytes = DEFAULT_SOFT_QUEUE_BYTES,
  hardThresholdBytes = DEFAULT_HARD_QUEUE_BYTES
) {
  const size = Math.max(0, Number(queueBytes) || 0);
  if (size >= hardThresholdBytes) return "hard";
  if (size >= softThresholdBytes) return "soft";
  return "ok";
}

function congestionAction({
  queueBytes,
  sustainedMs = 0,
  currentQuality = "medium",
  softThresholdBytes = DEFAULT_SOFT_QUEUE_BYTES,
  hardThresholdBytes = DEFAULT_HARD_QUEUE_BYTES,
  sustainedLimitMs = DEFAULT_SUSTAINED_MS,
}) {
  const level = queueCongestionLevel(queueBytes, softThresholdBytes, hardThresholdBytes);
  const quality = String(currentQuality || "medium");

  if (level === "hard") {
    return quality === "low" ? "fatal" : "stepdown";
  }
  if (level === "soft") {
    if ((Number(sustainedMs) || 0) >= sustainedLimitMs) {
      return quality === "low" ? "fatal" : "stepdown";
    }
    return "warn";
  }
  return "none";
}

function redactRtmpTarget(target) {
  const value = String(target || "").trim();
  if (!value) return "";
  try {
    const u = new URL(value);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      parts[parts.length - 1] = "******";
      u.pathname = `/${parts.join("/")}`;
    }
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "******";
  }
}

module.exports = {
  DEFAULT_MAX_DESTINATIONS,
  DEFAULT_SOFT_QUEUE_BYTES,
  DEFAULT_HARD_QUEUE_BYTES,
  DEFAULT_SUSTAINED_MS,
  isRtmpUrl,
  buildRtmpUrl,
  normalizeDestinations,
  buildTeeMuxerTarget,
  buildFfmpegArgs,
  nextRestartDelayMs,
  queueCongestionLevel,
  congestionAction,
  redactRtmpTarget,
};
