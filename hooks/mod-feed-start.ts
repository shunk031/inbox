import { startModFeed } from './mod-feed'

type ModFeedArgs = Parameters<typeof startModFeed>

/** Connects the mod's feed setting names to the host-neutral feed poller. */
export function startModFeedForMod(
  env: ModFeedArgs[0],
  run: ModFeedArgs[1],
  fs: ModFeedArgs[2],
  now: ModFeedArgs[3],
  commit: ModFeedArgs[4],
  sessionId: ModFeedArgs[5],
) {
  return startModFeed(env, run, fs, now, commit, sessionId)
}
