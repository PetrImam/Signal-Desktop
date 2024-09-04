// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod';
import type { ConversationType } from '../state/ducks/conversations';
import { safeParseInteger } from '../util/numbers';
import { byteLength } from '../Bytes';
import type { StorageServiceFieldsType } from '../sql/Interface';

export enum CallLinkUpdateSyncType {
  Update = 'Update',
  Delete = 'Delete',
}

export type CallLinkUpdateData = Readonly<{
  rootKey: Uint8Array;
  adminKey: Uint8Array | undefined;
}>;

/**
 * Names
 */

export const CallLinkNameMaxByteLength = 120;
export const CallLinkNameMaxLength = 32;

export const callLinkNameSchema = z.string().refine(input => {
  return byteLength(input) <= 120;
});

/**
 * Restrictions
 */

// Must match `CallLinkRestrictions` in @signalapp/ringrtc
export enum CallLinkRestrictions {
  None = 0,
  AdminApproval = 1,
  Unknown = 2,
}

export const callLinkRestrictionsSchema = z.nativeEnum(CallLinkRestrictions);

export function toCallLinkRestrictions(
  restrictions: number | string
): CallLinkRestrictions {
  return callLinkRestrictionsSchema.parse(safeParseInteger(restrictions));
}

/**
 * Link
 */

export type CallLinkType = Readonly<{
  roomId: string;
  rootKey: string;
  adminKey: string | null;
  name: string;
  restrictions: CallLinkRestrictions;
  // Revocation is not supported currently but still returned by the server
  revoked: boolean;
  // Guaranteed from RingRTC readCallLink, but locally may be null immediately after
  // CallLinkUpdate sync and before readCallLink
  expiration: number | null;
}> &
  StorageServiceFieldsType;

export type CallLinkStateType = Pick<
  CallLinkType,
  'name' | 'restrictions' | 'revoked' | 'expiration'
>;

// Ephemeral conversation-like type to satisfy components
export type CallLinkConversationType = ReadonlyDeep<
  Omit<ConversationType, 'type'> & {
    type: 'callLink';
    storySendMode?: undefined;
    acknowledgedGroupNameCollisions?: undefined;
  }
>;

// DB Record
export type CallLinkRecord = Readonly<{
  roomId: string;
  rootKey: Uint8Array | null;
  adminKey: Uint8Array | null;
  name: string;
  restrictions: number;
  expiration: number | null;
  revoked: 1 | 0; // sqlite's version of boolean
  deleted?: 1 | 0;
  deletedAt?: number | null;
  storageID: string | null;
  storageVersion: number | null;
  storageUnknownFields: Uint8Array | null;
  storageNeedsSync: 1 | 0;
}>;

export const callLinkRecordSchema = z.object({
  roomId: z.string(),
  // credentials
  rootKey: z.instanceof(Uint8Array).nullable(),
  adminKey: z.instanceof(Uint8Array).nullable(),
  // state
  name: callLinkNameSchema,
  restrictions: callLinkRestrictionsSchema,
  expiration: z.number().int().nullable(),
  revoked: z.union([z.literal(1), z.literal(0)]),
  deleted: z.union([z.literal(1), z.literal(0)]).optional(),
  deletedAt: z.number().int().nullable().optional(),
  storageID: z.string().nullable(),
  storageVersion: z.number().int().nullable(),
  storageUnknownFields: z.instanceof(Uint8Array).nullable(),
  storageNeedsSync: z.union([z.literal(1), z.literal(0)]),
}) satisfies z.ZodType<CallLinkRecord>;

export function isCallLinkAdmin(callLink: CallLinkType): boolean {
  return callLink.adminKey != null;
}
