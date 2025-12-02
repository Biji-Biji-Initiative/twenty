import { Injectable, Logger } from '@nestjs/common';

import { type FetchMessageObject, type ImapFlow } from 'imapflow';
import { type ParsedMail, simpleParser } from 'mailparser';

export type MessageParseResult = {
  uid: number;
  parsed: ParsedMail | null;
  error?: Error;
};

@Injectable()
export class ImapMessageParserService {
  private readonly logger = new Logger(ImapMessageParserService.name);

  async parseMessagesFromFolder(
    messageUids: number[],
    folderPath: string,
    client: ImapFlow,
  ): Promise<MessageParseResult[]> {
    if (!messageUids.length) {
      return [];
    }

    try {
      const lock = await client.getMailboxLock(folderPath);

      try {
        return await this.fetchAndParseMessages(messageUids, client);
      } finally {
        lock.release();
      }
    } catch (error) {
      this.logger.error(
        `Failed to parse messages from folder ${folderPath}: ${error.message}`,
      );

      return this.createErrorResults(messageUids, error as Error);
    }
  }

  private async fetchAndParseMessages(
    messageUids: number[],
    client: ImapFlow,
  ): Promise<MessageParseResult[]> {
    const uidSet = messageUids.join(',');
    const parsedByUid = new Map<number, MessageParseResult>();

    const fetchStream = client.fetch(
      uidSet,
      { uid: true, source: true },
      { uid: true },
    );

    for await (const message of fetchStream) {
      const result = await this.parseMessage(message);

      parsedByUid.set(message.uid, result);
    }

    return messageUids.map(
      (uid) => parsedByUid.get(uid) ?? { uid, parsed: null },
    );
  }

  private async parseMessage(
    message: FetchMessageObject,
  ): Promise<MessageParseResult> {
    const { uid, source } = message;

    if (!source) {
      this.logger.debug(`No source content for message UID ${uid}`);

      return { uid, parsed: null };
    }

    try {
      const parsed = await simpleParser(source, {
        skipTextToHtml: true,
        skipImageLinks: true,
        skipTextLinks: true,
        keepCidLinks: false,
      });

      return { uid, parsed };
    } catch (error) {
      this.logger.error(`Failed to parse message UID ${uid}: ${error.message}`);

      return { uid, parsed: null, error: error as Error };
    }
  }

  createErrorResults(
    messageUids: number[],
    error: Error,
  ): MessageParseResult[] {
    return messageUids.map((uid) => ({ uid, parsed: null, error }));
  }
}
