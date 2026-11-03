"use client";

import "@livekit/components-styles/components/participant";
import "@livekit/components-styles/components/layout";
import "./room.css";
import { CarouselLayout, GridLayout, ParticipantTile, VideoTrack, isTrackReference, useIsMuted, useParticipantAttributes, useTrackRefContext, useTracks } from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { MicOff } from "lucide-react";
import { Track } from "livekit-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { dedupeParticipants } from "./participants";
import { useActiveReaction } from "./reactions";

function TileBody() {
  const trackRef = useTrackRefContext();
  const participant = trackRef.participant;
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const name = participant.name || participant.identity;
  const reaction = useActiveReaction(participant.identity);
  const { attributes } = useParticipantAttributes({ participant });
  const raised = !isScreen && attributes?.handRaised === "true";
  const showScreen = isScreen && isTrackReference(trackRef) && !!trackRef.publication.track;
  return (
    <>
      {showScreen ? (
        <VideoTrack trackRef={trackRef} manageSubscription />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-rail-item">
          <span aria-hidden className="inline-flex size-16 items-center justify-center rounded-full bg-rail-item-hover text-xl font-semibold text-rail-foreground">
            {initials(name)}
          </span>
        </div>
      )}
      {raised ? (
        <span role="img" aria-label={`${name} đang giơ tay`} className="pointer-events-none absolute top-2 left-2 rounded-full bg-rail/85 px-2 py-1 text-lg leading-none">
          ✋
        </span>
      ) : null}
      {!isScreen && reaction ? (
        <span key={reaction.key} role="img" aria-label={`${name} thả ${reaction.emoji}`} data-reaction className="animate-pop pointer-events-none absolute top-2 right-2 rounded-full bg-rail/85 px-3 py-2 text-3xl leading-none">
          {reaction.emoji}
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center">
        <span className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md bg-rail/85 px-2 py-1 text-xs text-rail-foreground">
          {!isScreen && micMuted ? <MicOff className="size-3.5 shrink-0" aria-label="Đã tắt mic" /> : null}
          <span className="truncate">{isScreen ? `${name} đang chia sẻ màn hình` : participant.isLocal ? `${name} (Bạn)` : name}</span>
        </span>
      </div>
    </>
  );
}

function Tile({ trackRef, className }: { trackRef?: TrackReferenceOrPlaceholder; className?: string }) {
  return (
    <ParticipantTile trackRef={trackRef} className={cn("h-full w-full", className)}>
      <TileBody />
    </ParticipantTile>
  );
}

export function useStageTracks() {
  const tracks = useTracks(
    [
      { source: Track.Source.Microphone, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const visible = tracks.filter((t) => !t.participant.permissions?.hidden);
  const people = new Set(dedupeParticipants(visible.map((t) => t.participant)));
  const seen = new Set<string>();
  return visible.filter((t) => {
    if (!people.has(t.participant)) return false;
    const key = `${t.participant.identity}:${t.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function RoomStage() {
  const tracks = useStageTracks();
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const people = tracks.filter((t) => t.source === Track.Source.Microphone);
  if (screen) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          <Tile trackRef={screen} />
        </div>
        <div className="h-24 shrink-0 lg:h-auto lg:w-56">
          <CarouselLayout tracks={people}>
            <Tile />
          </CarouselLayout>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-0 min-w-0 flex-1 p-2">
      <GridLayout tracks={people}>
        <Tile />
      </GridLayout>
    </div>
  );
}
