import { Injectable, Logger } from '@nestjs/common';

import { type ImapFlow } from 'imapflow';

import { type MailboxState } from 'src/modules/messaging/message-import-manager/drivers/imap/utils/extract-mailbox-state.util';
import { type ImapSyncCursor } from 'src/modules/messaging/message-import-manager/drivers/imap/utils/parse-sync-cursor.util';

type SyncResult = {
  messageUids: number[];
  deletedMessageUids: number[];
};

@Injectable()
export class ImapSyncService {
  private readonly logger = new Logger(ImapSyncService.name);

  async syncFolder(
    client: ImapFlow,
    folderPath: string,
    previousCursor: ImapSyncCursor | null,
    mailboxState: MailboxState,
  ): Promise<SyncResult> {
    const deletedMessageUids = this.getDeletedUidsOnValidityChange(
      previousCursor,
      mailboxState,
      folderPath,
      client,
    );

    const messageUids = await this.fetchNewMessageUids(
      client,
      previousCursor,
      mailboxState,
      folderPath,
    );

    return {
      messageUids,
      deletedMessageUids: await deletedMessageUids,
    };
  }

  private async getDeletedUidsOnValidityChange(
    previousCursor: ImapSyncCursor | null,
    mailboxState: MailboxState,
    folderPath: string,
    client: ImapFlow,
  ): Promise<number[]> {
    const previousUidValidity = previousCursor?.uidValidity ?? 0;
    const { uidValidity } = mailboxState;

    if (previousUidValidity !== 0 && previousUidValidity !== uidValidity) {
      this.logger.log(
        `UID validity changed from ${previousUidValidity} to ${uidValidity} in ${folderPath}. Full resync required.`,
      );

      return this.fetchAllMessageUids(client);
    }

    return [];
  }

  private async fetchNewMessageUids(
    client: ImapFlow,
    previousCursor: ImapSyncCursor | null,
    mailboxState: MailboxState,
    folderPath: string,
  ): Promise<number[]> {
    const lastSyncedUid = previousCursor?.highestUid ?? 0;
    const { maxUid } = mailboxState;

    if (this.canUseQresync(client, previousCursor, mailboxState)) {
      this.logger.log(`Using QRESYNC for folder ${folderPath}`);

      try {
        return await this.fetchWithQresync(
          client,
          lastSyncedUid,
          BigInt(previousCursor!.modSeq!),
        );
      } catch (error) {
        this.logger.warn(
          `QRESYNC failed for ${folderPath}, falling back to UID range: ${error.message}`,
        );
      }
    }

    this.logger.log(`Using UID range fetch for folder ${folderPath}`);

    return this.fetchWithUidRange(client, lastSyncedUid, maxUid);
  }

  private canUseQresync(
    client: ImapFlow,
    previousCursor: ImapSyncCursor | null,
    mailboxState: MailboxState,
  ): boolean {
    const supportsQresync = client.capabilities.has('QRESYNC');
    const hasModSeq = previousCursor?.modSeq !== undefined;
    const hasServerModSeq = mailboxState.highestModSeq !== undefined;
    const uidValidityMatches =
      (previousCursor?.uidValidity ?? 0) === mailboxState.uidValidity ||
      previousCursor?.uidValidity === 0;

    return (
      supportsQresync && hasModSeq && hasServerModSeq && uidValidityMatches
    );
  }

  private async fetchAllMessageUids(client: ImapFlow): Promise<number[]> {
    const uids: number[] = [];

    for await (const message of client.fetch('1:*', {}, { uid: true })) {
      if (message.uid) {
        uids.push(message.uid);
      }
    }

    return uids;
  }

  private async fetchWithUidRange(
    client: ImapFlow,
    lastSyncedUid: number,
    highestAvailableUid: number,
  ): Promise<number[]> {
    if (lastSyncedUid >= highestAvailableUid) {
      return [];
    }

    const uids: number[] = [];
    const uidRange = `${lastSyncedUid + 1}:${highestAvailableUid}`;

    for await (const message of client.fetch(uidRange, {}, { uid: true })) {
      if (message.uid) {
        uids.push(message.uid);
      }
    }

    return uids;
  }

  private async fetchWithQresync(
    client: ImapFlow,
    lastSyncedUid: number,
    lastModSeq: bigint,
  ): Promise<number[]> {
    const searchResults = await client.search(
      {
        modseq: lastModSeq + BigInt(1),
        uid: `${lastSyncedUid + 1}:*`,
      },
      { uid: true },
    );

    if (
      !searchResults ||
      !Array.isArray(searchResults) ||
      !searchResults.length
    ) {
      return [];
    }

    this.logger.log(
      `QRESYNC found ${searchResults.length} new/modified messages`,
    );

    const uids: number[] = [];

    for await (const message of client.fetch(
      searchResults,
      {},
      { uid: true },
    )) {
      if (message.uid) {
        uids.push(message.uid);
      }
    }

    return uids;
  }
}
