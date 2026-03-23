const fs = require("fs");

const REPLIED_FILE = "replied.json";
const STATE_FILE = "state.json";

function loadJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function loadRepliedData() {
  return loadJson(REPLIED_FILE, {
    tweetIds: [],
    textHashes: [],
    authorCooldowns: {},
  });
}

function saveRepliedData(data) {
  saveJson(REPLIED_FILE, data);
}

function loadState() {
  return loadJson(STATE_FILE, {
    globalReplyTimes: [],
    recentSignals: [],
    lastPostTime: 0,
    postHistory: [],
  });
}

function saveState(data) {
  saveJson(STATE_FILE, data);
}

module.exports = {
  loadRepliedData,
  saveRepliedData,
  loadState,
  saveState,
};