/**
 * HanzoController — the @AuraEnabled surface the hanzoAssistant LWC calls.
 *
 * Three methods, one job each (separation of concerns):
 *   complete(task, recordId, model) — assemble record context, run one completion.
 *   listModels()                    — the routable model ids for the picker.
 *   writeBack(recordId, text, kind) — persist the AI output as a Task, a Note, or
 *                                     a Chatter post.
 *
 * All AuraEnabled methods throw AuraHandledException on failure so the LWC gets a
 * clean, user-facing message instead of a raw stack trace. The gateway key is never
 * seen here — HanzoClient's callout goes through the Named Credential.
 */
public with sharing class HanzoController {
    /** How to persist AI output. Matches the LWC's write-back menu. */
    public enum WriteKind {
        TASK,
        NOTE,
        CHATTER
    }

    /**
     * complete assembles the record context for recordId, then runs one
     * non-streaming completion with the caller's task. model is optional — blank
     * falls back to HanzoClient.DEFAULT_MODEL.
     */
    @AuraEnabled
    public static String complete(String task, Id recordId, String model) {
        if (String.isBlank(task)) {
            throw new AuraHandledException('Ask a question or pick an action first.');
        }
        try {
            String context = HanzoContext.build(recordId);
            String resolved = String.isBlank(model) ? defaultModel() : model;
            HanzoClient.Options opts = new HanzoClient.Options(resolved);
            return HanzoClient.ask(task, context, opts);
        } catch (HanzoClient.HanzoException e) {
            throw new AuraHandledException(e.getMessage());
        } catch (System.QueryException e) {
            throw new AuraHandledException('Could not read this record: ' + e.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * listModels returns the routable model ids for the picker. Non-fatal —
     * HanzoClient.listModels() returns [] on failure and the LWC defaults.
     */
    @AuraEnabled(cacheable=true)
    public static List<HanzoClient.ModelInfo> listModels() {
        return HanzoClient.listModels();
    }

    /**
     * writeBack persists AI output against the record. kind is 'TASK', 'NOTE', or
     * 'CHATTER' (case-insensitive). Returns the created record's Id so the LWC can
     * confirm and link. Runs in the user's context — a rep who can't create the
     * target record gets a clean permission error.
     */
    @AuraEnabled
    public static Id writeBack(Id recordId, String text, String kind) {
        if (recordId == null) {
            throw new AuraHandledException('No record in context.');
        }
        if (String.isBlank(text)) {
            throw new AuraHandledException('Nothing to save yet — run an action first.');
        }
        WriteKind wk = parseKind(kind);
        try {
            if (wk == WriteKind.TASK) {
                return createTask(recordId, text);
            } else if (wk == WriteKind.NOTE) {
                return createNote(recordId, text);
            } else {
                return postChatter(recordId, text);
            }
        } catch (DmlException e) {
            throw new AuraHandledException(dmlMessage(e));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ── Write-back implementations ─────────────────────────────────────────

    /**
     * Create a completed Task linked to the record. WhoId for people (Lead/Contact),
     * WhatId for everything else — Salesforce rejects a WhatId on a Lead/Contact.
     */
    private static Id createTask(Id recordId, String text) {
        Task t = new Task(
            Subject = 'Hanzo AI: ' + firstLine(text),
            Description = text,
            Status = 'Completed',
            Priority = 'Normal',
            ActivityDate = Date.today()
        );
        String prefix = String.valueOf(recordId).substring(0, 3);
        String contactPrefix = Contact.SObjectType.getDescribe().getKeyPrefix();
        String leadPrefix = Lead.SObjectType.getDescribe().getKeyPrefix();
        if (prefix == contactPrefix || prefix == leadPrefix) {
            t.WhoId = recordId;
        } else {
            t.WhatId = recordId;
        }
        insert as user t;
        return t.Id;
    }

    /**
     * Create a ContentNote (the modern Notes tool) and link it to the record via a
     * ContentDocumentLink. Body must be HTML-escaped rich text.
     */
    private static Id createNote(Id recordId, String text) {
        ContentNote note = new ContentNote(
            Title = 'Hanzo AI — ' + firstLine(text),
            Content = Blob.valueOf(toNoteHtml(text))
        );
        insert as user note;
        ContentDocumentLink link = new ContentDocumentLink(
            ContentDocumentId = note.Id,
            LinkedEntityId = recordId,
            ShareType = 'V',
            Visibility = 'AllUsers'
        );
        insert as user link;
        return note.Id;
    }

    /** Post the AI output to the record's Chatter feed. */
    private static Id postChatter(Id recordId, String text) {
        FeedItem post = new FeedItem(
            ParentId = recordId,
            Body = text
        );
        insert as user post;
        return post.Id;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /**
     * defaultModel reads the org's default model from the Hanzo_Config__mdt
     * 'Default' record (non-secret config), falling back to the client default so
     * a missing record never breaks a completion. One source of the default.
     */
    private static String defaultModel() {
        Hanzo_Config__mdt cfg = Hanzo_Config__mdt.getInstance('Default');
        if (cfg != null && !String.isBlank(cfg.Default_Model__c)) {
            return cfg.Default_Model__c;
        }
        return HanzoClient.DEFAULT_MODEL;
    }

    /** Parse a case-insensitive kind, defaulting to a clear error. */
    private static WriteKind parseKind(String kind) {
        String k = kind == null ? '' : kind.trim().toUpperCase();
        if (k == 'TASK') {
            return WriteKind.TASK;
        }
        if (k == 'NOTE') {
            return WriteKind.NOTE;
        }
        if (k == 'CHATTER' || k == 'POST') {
            return WriteKind.CHATTER;
        }
        throw new AuraHandledException('Unknown save target: ' + kind);
    }

    /** First line of the text, capped so it fits a Task Subject (max 255). */
    private static String firstLine(String text) {
        String line = text.split('\n')[0].trim();
        return line.length() > 200 ? line.substring(0, 200) : line;
    }

    /**
     * ContentNote.Content requires HTML: escape the text and turn newlines into
     * <br> so the note renders with the model's line breaks intact.
     */
    private static String toNoteHtml(String text) {
        return text.escapeHtml4().replace('\n', '<br>');
    }

    /** A user-facing message for a DML failure (FLS/CRUD/validation). */
    private static String dmlMessage(DmlException e) {
        return e.getNumDml() > 0 ? e.getDmlMessage(0) : e.getMessage();
    }
}
