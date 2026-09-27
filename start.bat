require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const num = (key, fallback) => Number.isFinite(Number(process.env[key])) ? Number(process.env[key]) : fallback;
const state = loadState();
let lastEvent = null;
const baselineAt = Date.parse(process.env.BASELINE_AT || '2026-09-27T03:07:43.000Z');
const guildId = process.env.DISCORD_GUILD_ID || '1317998408866201681';
const channelId = process.env.APPY_CHANNEL_ID || '1441148732597997719';
const acceptMarkers = markers('ACCEPT_MARKERS', ['application accepted','accepted application','application approved']);
const denyMarkers = markers('DENY_MARKERS', ['application denied','denied application','application rejected']);

function loadState(){
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      total: Number(raw.total ?? num('BASELINE_TOTAL', 2766)),
      accepted: Number(raw.accepted ?? num('BASELINE_ACCEPTED', 1098)),
      denied: Number(raw.denied ?? num('BASELINE_DENIED', 1651)),
      pending: Number(raw.pending ?? num('BASELINE_PENDING', 17)),
      last7Days: Number(raw.last7Days ?? 0),
      messageStates: raw.messageStates || {}
    };
  } catch {
    return {
      total: num('BASELINE_TOTAL', 2766),
      accepted: num('BASELINE_ACCEPTED', 1098),
      denied: num('BASELINE_DENIED', 1651),
      pending: num('BASELINE_PENDING', 17),
      last7Days: 0,
      messageStates: {}
    };
  }
}
function saveState(){ fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function markers(key, defaults){
  return String(process.env[key] || defaults.join(',')).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
}
function textFromMessage(message){
  const chunks = [message.content || '', message.author?.username || ''];
  for(const e of message.embeds || []){
    chunks.push(e.title || '', e.description || '', e.footer?.text || '', e.author?.name || '');
    for(const f of e.fields || []) chunks.push(f.name || '', f.value || '');
  }
  for(const row of message.components || []){
    for(const c of row.components || []) chunks.push(c.label || '', c.customId || '');
  }
  return chunks.join('\n').replace(/\s+/g, ' ').trim().toLowerCase();
}
function classify(message){
  const text = textFromMessage(message);
  const labels = [];
  for(const row of message.components || []) for(const c of row.components || []) if(c.label) labels.push(String(c.label).toLowerCase());

  // Appy's accepted/denied notices are embeds. The screenshot you supplied shows the exact
  // accepted title: "Application accepted". Check the embed title first so this remains
  // reliable even when the message body changes.
  const embedTitles = (message.embeds || []).map(e => String(e.title || '').trim().toLowerCase());
  if(embedTitles.some(t => /^application\s+accepted\b/.test(t) || t === 'accepted')) return 'accepted';
  if(embedTitles.some(t => /^application\s+(denied|rejected)\b/.test(t) || t === 'denied' || t === 'rejected')) return 'denied';

  const hasAcceptButton = labels.some(x => x.includes('accept'));
  const hasDenyButton = labels.some(x => x.includes('deny') || x.includes('reject'));

  // Strong status phrases are checked before generic words so an answer mentioning "denied"
  // in an unrelated field is less likely to count.
  if(acceptMarkers.some(m => text.includes(m))) return 'accepted';
  if(denyMarkers.some(m => text.includes(m))) return 'denied';
  if(hasAcceptButton && hasDenyButton) return 'pending';

  if(labels.some(x => x === 'accepted' || x.includes('accepted'))) return 'accepted';
  if(labels.some(x => x === 'denied' || x.includes('denied') || x.includes('rejected'))) return 'denied';
  return null;
}
function adjust(status, delta){
  if(status === 'accepted') state.accepted = Math.max(0, state.accepted + delta);
  else if(status === 'denied') state.denied = Math.max(0, state.denied + delta);
  else if(status === 'pending') state.pending = Math.max(0, state.pending + delta);
}
function statusChanged(message, next){
  const id = message.id;
  const previous = state.messageStates[id];
  if(previous === next) return false;
  if(previous) adjust(previous, -1);
  if(next) adjust(next, 1);
  state.messageStates[id] = next || null;
  return true;
}
function isApplicationChannel(message){ return message.channelId === channelId; }
function maybeCountNew(message){
  if(!isApplicationChannel(message)) return false;
  const status = classify(message);
  const isNewSinceBaseline = message.createdTimestamp >= baselineAt;
  if(!(message.id in state.messageStates)){
    state.messageStates[message.id] = status || null;
    if(isNewSinceBaseline && status){
      state.total += 1;
      adjust(status, 1);
      saveState();
      lastEvent = {type:'new', status, messageId:message.id, at:new Date().toISOString()};
      console.log(`[Appy] new ${status}: ${message.id}`);
      return true;
    }
    saveState();
  }
  return false;
}
function recomputeLast7Days(){
  // The baseline export is a snapshot, so this is intentionally a best-effort live counter.
  // New application events are tracked by their Discord message timestamps.
  const cutoff = Date.now() - 7*24*60*60*1000;
  let n = 0;
  for(const [id,status] of Object.entries(state.messageStates)){
    if(!status) continue;
    const ts = Number(idToTimestamp(id));
    if(ts >= cutoff) n++;
  }
  state.last7Days = n;
}
function idToTimestamp(id){
  try { return Number((BigInt(id) >> 22n)) + 1420070400000; } catch { return 0; }
}
function publicStats(){ recomputeLast7Days(); return { total:state.total, accepted:state.accepted, denied:state.denied, pending:state.pending, last7Days:state.last7Days, connected:client?.isReady?.() || false, updatedAt:new Date().toISOString(), lastEvent }; }

app.use(express.static(__dirname));
app.get('/api/stats', (req,res)=>res.json(publicStats()));
app.get('/api/health', (req,res)=>res.json({ok:true, discordReady:client?.isReady?.() || false, channelId, updatedAt:new Date().toISOString()}));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message]
});

client.once('ready', async () => {
  console.log(`Discord bot ready as ${client.user.tag}`);
  console.log(`Watching guild ${guildId}, Appy channel ${channelId}`);
  try { await seedExistingMessages(); } catch (err) { console.error('Initial Appy scan failed:', err.message); }
  saveState();
});

client.on('messageCreate', message => {
  try { maybeCountNew(message); } catch(err) { console.error('messageCreate:', err.message); }
});
client.on('messageUpdate', async (_old, fresh) => {
  try {
    if(fresh.partial) fresh = await fresh.fetch();
    if(!isApplicationChannel(fresh)) return;
    const next = classify(fresh);
    if(!(fresh.id in state.messageStates)){
      // If this is a post-snapshot message that arrived while the bot was offline, count its current state once.
      state.messageStates[fresh.id] = next || null;
      if(fresh.createdTimestamp >= baselineAt && next){
        state.total += 1;
        adjust(next, 1);
        console.log(`[Appy] recovered new ${next}: ${fresh.id}`);
      }
      saveState();
      return;
    }
    const changed = statusChanged(fresh, next);
    if(changed){ lastEvent = {type:'changed', status:next, messageId:fresh.id, at:new Date().toISOString()}; saveState(); console.log(`[Appy] status changed: ${fresh.id} -> ${next}`); }
  } catch(err) { console.error('messageUpdate:', err.message); }
});

async function seedExistingMessages(){
  const channel = await client.channels.fetch(channelId);
  if(!channel || !channel.isTextBased()) throw new Error('APPY_CHANNEL_ID is not a readable text channel.');
  let before;
  let scanned = 0;
  while(true){
    const options = { limit:100 };
    if(before) options.before = before;
    const batch = await channel.messages.fetch(options);
    if(!batch.size) break;
    for(const message of batch.values()){
      const status = classify(message);
      if(!(message.id in state.messageStates)){
        state.messageStates[message.id] = status || null;

        // If the bot was started after an Accept/Deny action, messageCreate never fired.
        // Count status notices created after the CSV baseline during the initial scan.
        if(message.createdTimestamp >= baselineAt && status){
          if(status === 'accepted') state.accepted += 1;
          else if(status === 'denied') state.denied += 1;
          else if(status === 'pending') state.pending += 1;
          console.log(`[Appy] initial sync counted ${status}: ${message.id}`);
        }
      }
      scanned++;
    }
    before = batch.last().id;
    if(batch.size < 100) break;
    // Safety: do not hammer Discord during the first sync.
    await new Promise(r=>setTimeout(r, 350));
  }
  console.log(`[Appy] scanned ${scanned} messages; baseline counts were preserved.`);
  saveState();
}

app.listen(PORT, ()=>console.log(`Knowledge Team dashboard running at http://localhost:${PORT}`));

if(!process.env.DISCORD_TOKEN){
  console.warn('DISCORD_TOKEN is missing. Website will run, but live Discord syncing is disabled.');
} else {
  client.login(process.env.DISCORD_TOKEN).catch(err=>console.error('Discord login failed:', err.message));
}
