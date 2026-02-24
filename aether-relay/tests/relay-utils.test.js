const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFfmpegArgs,
  normalizeDestinations,
  congestionAction,
  queueCongestionLevel,
} = require("../relay-utils");

test("buildFfmpegArgs builds a single-output flv chain without tee", () => {
  const output = "rtmps://a.rtmp.youtube.com/live2/abcd-1234";
  const args = buildFfmpegArgs({ outputs: [output] });

  assert.equal(args.includes("tee"), false);
  assert.deepEqual(args.slice(-3), ["-f", "flv", output]);
  assert.equal(args.filter((v) => v === output).length, 1);
});

test("normalizeDestinations dedupes and caps destinations", () => {
  const outputs = normalizeDestinations({
    streamKey: "abcd-1234",
    primaryBase: "rtmps://a.rtmp.youtube.com/live2",
    maxDestinations: 4,
    destinations: [
      "rtmps://live.twitch.tv/app/key1",
      "rtmps://live.twitch.tv/app/key1",
      "https://not-valid",
      "rtmps://live-api-s.facebook.com:443/rtmp/key2",
      "rtmps://example.com/live/key3",
      "rtmps://example.com/live/key4",
    ],
  });

  assert.equal(outputs.length, 4);
  assert.equal(outputs[0], "rtmps://a.rtmp.youtube.com/live2/abcd-1234");
  assert.equal(outputs[1], "rtmps://live.twitch.tv/app/key1");
  assert.equal(outputs.includes("https://not-valid"), false);
});

test("normalizeDestinations accepts full RTMP stream URL as primary", () => {
  const streamUrl = "rtmps://live-api-s.facebook.com:443/rtmp/some-primary-key";
  const outputs = normalizeDestinations({
    streamKey: streamUrl,
    primaryBase: "rtmps://a.rtmp.youtube.com/live2",
    destinations: [],
  });

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0], streamUrl);
});

test("normalizeDestinations accepts TikTok rtmp:// URL as primary", () => {
  const tiktokUrl = "rtmp://push.tiktokcdn.com/live/stream-key-tiktok-123";
  const outputs = normalizeDestinations({
    streamKey: tiktokUrl,
    primaryBase: "rtmps://a.rtmp.youtube.com/live2",
    destinations: [],
  });

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0], tiktokUrl);
});

test("normalizeDestinations accepts Kick rtmps:// URL as primary", () => {
  const kickUrl = "rtmps://fa723fc1b171.global-contribute.live-video.net/app/stream-key-kick-456";
  const outputs = normalizeDestinations({
    streamKey: kickUrl,
    primaryBase: "rtmps://a.rtmp.youtube.com/live2",
    destinations: [],
  });

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0], kickUrl);
});

test("normalizeDestinations handles all 5 platforms as multi-destination", () => {
  const outputs = normalizeDestinations({
    streamKey: "yt-key-123",
    primaryBase: "rtmps://a.rtmp.youtube.com/live2",
    maxDestinations: 5,
    destinations: [
      "rtmps://live.twitch.tv/app/twitch-key",
      "rtmps://live-api-s.facebook.com:443/rtmp/fb-key",
      "rtmp://push.tiktokcdn.com/live/tiktok-key",
      "rtmps://fa723fc1b171.global-contribute.live-video.net/app/kick-key",
    ],
  });

  assert.equal(outputs.length, 5);
  assert.equal(outputs[0], "rtmps://a.rtmp.youtube.com/live2/yt-key-123");
  assert.equal(outputs[1], "rtmps://live.twitch.tv/app/twitch-key");
  assert.equal(outputs[2], "rtmps://live-api-s.facebook.com:443/rtmp/fb-key");
  assert.equal(outputs[3], "rtmp://push.tiktokcdn.com/live/tiktok-key");
  assert.equal(outputs[4], "rtmps://fa723fc1b171.global-contribute.live-video.net/app/kick-key");
});

test("buildFfmpegArgs uses tee muxer for multi-platform output", () => {
  const outputs = [
    "rtmps://a.rtmp.youtube.com/live2/yt-key",
    "rtmps://live.twitch.tv/app/twitch-key",
    "rtmp://push.tiktokcdn.com/live/tiktok-key",
    "rtmps://fa723fc1b171.global-contribute.live-video.net/app/kick-key",
  ];
  const args = buildFfmpegArgs({ outputs });

  assert.equal(args.includes("tee"), true);
  const teeTarget = args[args.indexOf("tee") + 1];
  for (const url of outputs) {
    assert.equal(teeTarget.includes(url), true, `tee target must include ${url}`);
  }
  assert.equal(teeTarget.includes("onfail=ignore"), true);
});

test("queueCongestionLevel and congestionAction follow warn -> stepdown -> fatal", () => {
  const soft = 2 * 1024 * 1024;
  const hard = 8 * 1024 * 1024;

  assert.equal(queueCongestionLevel(soft - 1, soft, hard), "ok");
  assert.equal(queueCongestionLevel(soft + 100, soft, hard), "soft");
  assert.equal(queueCongestionLevel(hard + 100, soft, hard), "hard");

  assert.equal(
    congestionAction({ queueBytes: soft + 1, sustainedMs: 1000, currentQuality: "medium" }),
    "warn"
  );
  assert.equal(
    congestionAction({ queueBytes: soft + 1, sustainedMs: 6000, currentQuality: "medium" }),
    "stepdown"
  );
  assert.equal(
    congestionAction({ queueBytes: hard + 1, sustainedMs: 0, currentQuality: "low" }),
    "fatal"
  );
});
