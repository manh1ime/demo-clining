import { hasRedis, redis } from "./bot-store.js";

export { hasRedis };

const REVISION_KEY = "legche:v2:prospects:revision";
const INDEX_KEY = "legche:v2:prospects:index";
const RECORD_PREFIX = "legche:v2:prospect:";

const SNAPSHOT_SCRIPT = `-- LEGECHE_PROSPECT_SNAPSHOT_V2
local current=tonumber(redis.call('GET',KEYS[1]) or '0')
local expected=tonumber(ARGV[1])
if current~=expected then return {0,current} end
local count=tonumber(ARGV[2])
local keep={}
local pos=3
for i=1,count do
  local id=ARGV[pos]
  local json=ARGV[pos+1]
  local score=tonumber(ARGV[pos+2])
  keep[id]=true
  redis.call('SET','legche:v2:prospect:'..id,json)
  redis.call('ZADD',KEYS[2],score,id)
  pos=pos+3
end
local old=redis.call('ZRANGE',KEYS[2],0,-1)
for _,id in ipairs(old) do
  if not keep[id] then
    redis.call('DEL','legche:v2:prospect:'..id)
    redis.call('ZREM',KEYS[2],id)
  end
end
local next=current+1
redis.call('SET',KEYS[1],next)
return {1,next}`;

export async function getProspectSnapshot(knownRevision = -1) {
  const revision = Number(await redis("GET", REVISION_KEY) || 0);
  if (Number(knownRevision) === revision) return { changed: false, revision, items: [] };
  const ids = await redis("ZREVRANGE", INDEX_KEY, 0, 499);
  if (!ids?.length) return { changed: true, revision, items: [] };
  const raws = await redis("MGET", ...ids.map((id) => `${RECORD_PREFIX}${id}`));
  return { changed: true, revision, items: raws.filter(Boolean).map(JSON.parse) };
}

export async function saveProspectSnapshot(items, expectedRevision) {
  const args = [String(Number(expectedRevision) || 0), String(items.length)];
  for (const item of items) {
    args.push(item.id, JSON.stringify(item), String(Date.parse(item.updatedAt || item.createdAt) || Date.now()));
  }
  const result = await redis("EVAL", SNAPSHOT_SCRIPT, 2, REVISION_KEY, INDEX_KEY, ...args);
  return { saved: Number(result?.[0]) === 1, revision: Number(result?.[1]) || 0 };
}
