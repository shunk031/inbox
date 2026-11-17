import { startModFeed } from './mod-feed'

type ModFeedArgs = Parameters<typeof startModFeed>
type ModFeedFs = {
  stat: ModFeedArgs[2][0]
  list: ModFeedArgs[2][1]
  exists: ModFeedArgs[2][2]
  read: ModFeedArgs[2][3]
  resolve: NonNullable<ModFeedArgs[2][4]>
}

/** Connects Claude Code's feed settings and filesystem callbacks to the shared feed poller. */
export function startModFeedForMod(args: {
  env: ModFeedArgs[0]
  run: ModFeedArgs[1]
  fs: ModFeedFs
  now: ModFeedArgs[3]
  commit: ModFeedArgs[4]
  sessionId: ModFeedArgs[5]
}) {
  return startModFeed(
    args.env,
    args.run,
    [args.fs.stat, args.fs.list, args.fs.exists, args.fs.read, args.fs.resolve],
    args.now,
    args.commit,
    args.sessionId,
  )
}
