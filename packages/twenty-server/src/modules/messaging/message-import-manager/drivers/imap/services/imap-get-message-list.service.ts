import { Injectable, Logger } from '@nestjs/common';

import { type ImapFlow } from 'imapflow';
import { isDefined } from 'twenty-shared/utils';

import { type MessageFolderWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-folder.workspace-entity';
import {
  MessageImportDriverException,
  MessageImportDriverExceptionCode,
} from 'src/modules/messaging/message-import-manager/drivers/exceptions/message-import-driver.exception';
import { ImapClientProvider } from 'src/modules/messaging/message-import-manager/drivers/imap/providers/imap-client.provider';
import { ImapIncrementalSyncService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-incremental-sync.service';
import { ImapMessageListFetchErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-message-list-fetch-error-handler.service';
import { createSyncCursor } from 'src/modules/messaging/message-import-manager/drivers/imap/utils/create-sync-cursor.util';
import { extractMailboxState } from 'src/modules/messaging/message-import-manager/drivers/imap/utils/extract-mailbox-state.util';
import {
  ImapSyncCursor,
  parseSyncCursor,
} from 'src/modules/messaging/message-import-manager/drivers/imap/utils/parse-sync-cursor.util';
import { type GetMessageListsArgs } from 'src/modules/messaging/message-import-manager/types/get-message-lists-args.type';
import {
  type GetMessageListsResponse,
  type GetOneMessageListResponse,
} from 'src/modules/messaging/message-import-manager/types/get-message-lists-response.type';

@Injectable()
export class ImapGetMessageListService {
  private readonly logger = new Logger(ImapGetMessageListService.name);

  constructor(
    private readonly imapClientProvider: ImapClientProvider,
    private readonly imapIncrementalSyncService: ImapIncrementalSyncService,
    private readonly imapMessageListFetchErrorHandler: ImapMessageListFetchErrorHandler,
  ) {}

  public async getMessageLists({
    connectedAccount,
    messageFolders,
  }: GetMessageListsArgs): Promise<GetMessageListsResponse> {
    let client: ImapFlow | null = null;

    try {
      client = await this.imapClientProvider.getClient(connectedAccount);

      const result: GetMessageListsResponse = [];

      for (const folder of messageFolders) {
        const response = await this.getMessageList(client, folder);

        result.push({
          ...response,
          folderId: folder.id,
        });
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Connected account ${connectedAccount.id}: Error fetching message list: ${error.message}`,
      );

      this.imapMessageListFetchErrorHandler.handleError(error);

      throw error;
    } finally {
      if (client) {
        await this.imapClientProvider.closeClient(client);
      }
    }
  }

  public async getMessageList(
    client: ImapFlow,
    messageFolder: Pick<
      MessageFolderWorkspaceEntity,
      'name' | 'syncCursor' | 'externalId'
    >,
  ): Promise<GetOneMessageListResponse> {
    const folderPath = messageFolder.externalId?.split(':')[0];

    if (!folderPath) {
      throw new MessageImportDriverException(
        `Folder ${messageFolder.name} has no path`,
        MessageImportDriverExceptionCode.NOT_FOUND,
      );
    }

    if (!isDefined(messageFolder.syncCursor)) {
      throw new MessageImportDriverException(
        'Message folder sync cursor is required',
        MessageImportDriverExceptionCode.SYNC_CURSOR_ERROR,
      );
    }

    this.logger.log(`Processing folder: ${messageFolder.name}`);

    const { messages, messageExternalUidsToDelete, syncCursor } =
      await this.getMessagesFromFolder(
        client,
        folderPath,
        messageFolder.syncCursor,
      ).catch((error) => {
        this.logger.error(
          `Error fetching from folder ${messageFolder.name}: ${error.message}`,
        );

        this.imapMessageListFetchErrorHandler.handleError(error);

        throw error;
      });

    messages.sort((a, b) => b.uid - a.uid);

    const messageExternalIds = messages.map(
      (message) => `${folderPath}:${message.uid.toString()}`,
    );

    return {
      messageExternalIds,
      nextSyncCursor: JSON.stringify(syncCursor),
      previousSyncCursor: messageFolder.syncCursor || '',
      messageExternalIdsToDelete: messageExternalUidsToDelete.map((uid) =>
        uid.toString(),
      ),
      folderId: undefined,
    };
  }

  private async getMessagesFromFolder(
    client: ImapFlow,
    folder: string,
    cursor: string,
  ): Promise<{
    messages: { uid: number }[];
    messageExternalUidsToDelete: number[];
    syncCursor: ImapSyncCursor;
  }> {
    const lock = await client.getMailboxLock(folder);

    try {
      const mailbox = client.mailbox!;

      if (typeof mailbox === 'boolean') {
        throw new MessageImportDriverException(
          `Invalid mailbox state for folder ${folder}`,
          MessageImportDriverExceptionCode.UNKNOWN,
        );
      }

      const mailboxState = extractMailboxState(mailbox);
      const previousCursor = parseSyncCursor(cursor);

      const { messages, messageExternalUidsToDelete } =
        await this.imapIncrementalSyncService.syncMessages(
          client,
          previousCursor,
          mailboxState,
          folder,
        );

      const newSyncCursor = createSyncCursor(
        messages,
        previousCursor,
        mailboxState,
      );

      return {
        messages,
        messageExternalUidsToDelete,
        syncCursor: newSyncCursor,
      };
    } finally {
      lock.release();
    }
  }
}
