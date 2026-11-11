import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import {
  clearImageStudioDraft,
  hasImageStudioDraftContent,
  loadImageStudioDraft,
  saveImageStudioDraft,
  type ImageStudioWorkflow,
} from '@/lib/creation/image-studio-draft';

type ImageStudioDraftStatus = 'checking' | 'idle' | 'saved' | 'error';

export function useImageStudioDraft(options: { ready: boolean; hasUnpersistedReferences: boolean }) {
  const [prompt, setPromptState] = useState('');
  const [workflow, setWorkflowState] = useState<ImageStudioWorkflow>('generate');
  const [status, setStatus] = useState<ImageStudioDraftStatus>('checking');
  const [draftHadReferences, setDraftHadReferences] = useState(false);
  const [referencesNoticeVisible, setReferencesNoticeVisible] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const draftLoadStarted = useRef(false);
  const interactionStarted = useRef(false);

  const setPrompt = useCallback((action: SetStateAction<string>) => {
    interactionStarted.current = true;
    if (action === '') {
      setDraftHadReferences(false);
      setReferencesNoticeVisible(false);
    }
    setPromptState(action);
  }, []);

  const setWorkflow = useCallback((action: SetStateAction<ImageStudioWorkflow>) => {
    interactionStarted.current = true;
    setWorkflowState(action);
  }, []);

  const markInteraction = useCallback(() => {
    interactionStarted.current = true;
  }, []);

  const dismissReferencesNotice = useCallback(() => {
    setDraftHadReferences(false);
    setReferencesNoticeVisible(false);
  }, []);

  useEffect(() => {
    if (!options.ready || draftLoadStarted.current) return;
    draftLoadStarted.current = true;

    const draft = loadImageStudioDraft();
    if (draft && !interactionStarted.current && !prompt && workflow === 'generate' && !options.hasUnpersistedReferences) {
      setPromptState(draft.prompt);
      setWorkflowState(draft.workflow);
      setDraftHadReferences(draft.hasUnpersistedReferences);
      setReferencesNoticeVisible(draft.hasUnpersistedReferences);
    }
    setDraftReady(true);
    setStatus('idle');
  }, [options.hasUnpersistedReferences, options.ready, prompt, workflow]);

  useEffect(() => {
    if (!options.ready || !draftReady) return;
    if (!hasImageStudioDraftContent({ prompt, workflow })) {
      clearImageStudioDraft();
      setStatus('idle');
      return;
    }

    const saved = saveImageStudioDraft({
      prompt,
      workflow,
      hasUnpersistedReferences: options.hasUnpersistedReferences || draftHadReferences,
    });
    setStatus(saved ? 'saved' : 'error');
  }, [draftHadReferences, draftReady, options.hasUnpersistedReferences, options.ready, prompt, workflow]);

  return {
    prompt,
    setPrompt,
    workflow,
    setWorkflow,
    status,
    referencesNoticeVisible,
    markInteraction,
    dismissReferencesNotice,
  };
}
