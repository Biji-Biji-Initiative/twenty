import { Injectable, Logger } from '@nestjs/common';

import { type ImapFlow } from 'imapflow';

@Injectable()
export class ImapMessageFetcherService {
  private readonly logger = new Logger(ImapMessageFetcherService.name);

  public async getAllMessageUids(client: ImapFlow): Promise<number[]> {
    const uids: number[] = [];

    for await (const msg of client.fetch('1:*', {}, { uid: true })) {
      if (msg.uid) {
        uids.push(msg.uid);
      }
    }

    return uids;
  }

  public async getMessagesWithUidSearch(
    client: ImapFlow,
    lastSeenUid: number,
    maxUid: number,
  ): Promise<{ uid: number }[]> {
    try {
      const messages: { uid: number }[] = [];

      for await (const msg of client.fetch('1:*', {}, { uid: true })) {
        if (msg.uid && msg.uid > lastSeenUid && msg.uid <= maxUid) {
          messages.push({ uid: msg.uid });
        }
      }

      return messages;
    } catch (err) {
      this.logger.error(`Error fetching messages: ${err.message}`);
      throw err;
    }
  }

  public async getMessagesWithQresync(
    client: ImapFlow,
    lastSeenUid: number,
    lastModSeq: bigint,
  ): Promise<{ uid: number }[]> {
    try {
      const vanished = await client.search(
        {
          modseq: lastModSeq + BigInt(1),
          uid: `${lastSeenUid + 1}:*`,
        },
        { uid: true },
      );

      const messages: { uid: number }[] = [];

      if (vanished && Array.isArray(vanished) && vanished.length > 0) {
        this.logger.log(
          `QRESYNC: Fetching ${vanished.length} new/modified messages`,
        );

        for await (const msg of client.fetch(
          vanished,
          {},
          {
            uid: true,
          },
        )) {
          if (msg.uid) {
            messages.push({ uid: msg.uid });
          }
        }
      }

      return messages;
    } catch (err) {
      this.logger.error(`Error with QRESYNC: ${err.message}`);
      throw err;
    }
  }
}
