import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { PaperAirplaneIcon, StopIcon, FolderIcon, ChevronDownIcon } from '@heroicons/react/24/solid';
import { PhotoIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { configService } from '../../services/config';
import type { AppConfig } from '../../config';
import PaperClipIcon from '../icons/PaperClipIcon';
import XMarkIcon from '../icons/XMarkIcon';
import ModelSelector from '../ModelSelector';
import FolderSelectorPopover from './FolderSelectorPopover';
import { SkillsButton, ActiveSkillBadge } from '../skills';
import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { setDraftPrompt, setDraftAttachments, clearDraftAttachments, type DraftAttachment } from '../../store/slices/coworkSlice';
import { setSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import { Skill } from '../../types/skill';
import { CoworkImageAttachment } from '../../types/cowork';
import { getCompactFolderName } from '../../utils/path';

// CoworkAttachment is aliased from the Redux-persisted DraftAttachment type
// so that attachment state survives view switches (cowork ↔ skills, etc.)
type CoworkAttachment = DraftAttachment;

const INPUT_FILE_LABEL = '输入文件';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

const isImagePath = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

const extractBase64FromDataUrl = (dataUrl: string): { mimeType: string; base64Data: string } | null => {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
};

const getFileNameFromPath = (path: string): string => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

const getSkillDirectoryFromPath = (skillPath: string): string => {
  const normalized = skillPath.trim().replace(/\\/g, '/');
  return normalized.replace(/\/SKILL\.md$/i, '') || normalized;
};

const buildInlinedSkillPrompt = (skill: Skill): string => {
  const skillDirectory = getSkillDirectoryFromPath(skill.skillPath);
  return [
    `## Skill: ${skill.name}`,
    '<skill_context>',
    `  <location>${skill.skillPath}</location>`,
    `  <directory>${skillDirectory}</directory>`,
    '  <path_rules>',
    '    Resolve relative file references from this skill against <directory>.',
    '    Do not assume skills are under the current workspace directory.',
    '  </path_rules>',
    '</skill_context>',
    '',
    skill.prompt,
  ].join('\n');
};

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface CoworkPromptInputProps {
  onSubmit: (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  size?: 'normal' | 'large';
  workingDirectory?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  showFolderSelector?: boolean;
  showModelSelector?: boolean;
  onManageSkills?: () => void;
  sessionId?: string;
  /** When true, hides attachment/skill buttons but keeps the input box visible (disabled) */
  remoteManaged?: boolean;
}

const CoworkPromptInput = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => {
    const {
      onSubmit,
      onStop,
      isStreaming = false,
      placeholder = 'Enter your task...',
      disabled = false,
      size = 'normal',
      workingDirectory = '',
      onWorkingDirectoryChange,
      showFolderSelector = false,
      showModelSelector = false,
      onManageSkills,
      sessionId,
      remoteManaged = false,
    } = props;
    const dispatch = useDispatch();
    const draftKey = sessionId || '__home__';
    const draftPrompt = useSelector((state: RootState) => state.cowork.draftPrompts[draftKey] || '');
    const attachments = useSelector((state: RootState) => state.cowork.draftAttachments[draftKey] || []) as CoworkAttachment[];
    const [value, setValue] = useState(draftPrompt);
    const [showFolderMenu, setShowFolderMenu] = useState(false);
    const [showFolderRequiredWarning, setShowFolderRequiredWarning] = useState(false);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [isAddingFile, setIsAddingFile] = useState(false);
    const [imageVisionHint, setImageVisionHint] = useState(false);
    const [sendShortcut, setSendShortcut] = useState<AppConfig['sendMessageShortcut']>('enter');
    const [customShortcutDisplay, setCustomShortcutDisplay] = useState('');
    const [showShortcutMenu, setShowShortcutMenu] = useState(false);
    
    // Use ref to always have access to latest shortcut value in event handlers
    const sendShortcutRef = useRef(sendShortcut);
    useEffect(() => {
      sendShortcutRef.current = sendShortcut;
    }, [sendShortcut]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const folderButtonRef = useRef<HTMLButtonElement>(null);
    const shortcutButtonRef = useRef<HTMLButtonElement>(null);
    const dragDepthRef = useRef(0);

    // Load send shortcut from config on mount
    useEffect(() => {
      const config = configService.getConfig();
      const shortcut = config.sendMessageShortcut ?? 'enter';
      setSendShortcut(shortcut);
      // If it's a custom shortcut (not 'enter' or 'ctrlEnter'), store it for display
      if (shortcut !== 'enter' && shortcut !== 'ctrlEnter') {
        setCustomShortcutDisplay(shortcut);
      } else {
        setCustomShortcutDisplay('');
      }
    }, []);

    // Reload shortcut when menu opens (to sync with settings changes)
    useEffect(() => {
      if (showShortcutMenu) {
        const config = configService.getConfig();
        const shortcut = config.sendMessageShortcut ?? 'enter';
        setSendShortcut(shortcut);
        if (shortcut !== 'enter' && shortcut !== 'ctrlEnter') {
          setCustomShortcutDisplay(shortcut);
        } else {
          setCustomShortcutDisplay('');
        }
      }
    }, [showShortcutMenu]);

    // Save send shortcut to config
    const handleShortcutChange = useCallback(async (shortcut: AppConfig['sendMessageShortcut']) => {
      console.log('[CoworkPromptInput] Changing shortcut to:', shortcut);
      // Update state immediately for responsive UI
      setSendShortcut(shortcut);
      if (shortcut !== 'enter' && shortcut !== 'ctrlEnter') {
        setCustomShortcutDisplay(shortcut);
      } else {
        setCustomShortcutDisplay('');
      }
      // Save to config (async, but UI already updated)
      try {
        await configService.updateConfig({ sendMessageShortcut: shortcut });
        console.log('[CoworkPromptInput] Shortcut saved successfully');
      } catch (error) {
        console.error('[CoworkPromptInput] Failed to save shortcut:', error);
      }
      // Close menu after a short delay to ensure click is processed
      setTimeout(() => setShowShortcutMenu(false), 50);
    }, []);

    // Close shortcut menu when clicking outside
    useEffect(() => {
      if (!showShortcutMenu) return;
      const handleClickOutside = (e: MouseEvent) => {
        if (shortcutButtonRef.current && !shortcutButtonRef.current.contains(e.target as Node)) {
          setShowShortcutMenu(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showShortcutMenu]);

  // 暴露方法给父组件
  React.useImperativeHandle(ref, () => ({
    setValue: (newValue: string) => {
      setValue(newValue);
      // 触发自动调整高度
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
        }
      });
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);

  const isLarge = size === 'large';
  const minHeight = isLarge ? 60 : 24;
  const maxHeight = isLarge ? 200 : 200;

  // Load skills on mount
  useEffect(() => {
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    });
    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [value, minHeight, maxHeight]);

  useEffect(() => {
    const handleFocusInput = (event: Event) => {
      const detail = (event as CustomEvent<{ clear?: boolean }>).detail;
      const shouldClear = detail?.clear ?? true;
      if (shouldClear) {
        setValue('');
        dispatch(clearDraftAttachments(draftKey));
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener('cowork:focus-input', handleFocusInput);
    return () => {
      window.removeEventListener('cowork:focus-input', handleFocusInput);
    };
  }, []);

  useEffect(() => {
    if (workingDirectory?.trim()) {
      setShowFolderRequiredWarning(false);
    }
  }, [workingDirectory]);

  // Sync value from draft when sessionId changes
  useEffect(() => {
    setValue(draftPrompt);
  }, [draftKey]); // intentionally omit draftPrompt to only trigger on session switch

  useEffect(() => {
    if (value !== draftPrompt) {
      const timer = setTimeout(() => {
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: value }));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, draftPrompt, dispatch, draftKey]);

  const handleSubmit = useCallback(async () => {
    if (showFolderSelector && !workingDirectory?.trim()) {
      setShowFolderRequiredWarning(true);
      return;
    }

    const trimmedValue = value.trim();
    if ((!trimmedValue && attachments.length === 0) || isStreaming || disabled) return;
    setShowFolderRequiredWarning(false);

    // Get active skills prompts and combine them
    const activeSkills = activeSkillIds
      .map(id => skills.find(s => s.id === id))
      .filter((s): s is Skill => s !== undefined);
    const skillPrompt = activeSkills.length > 0
      ? activeSkills.map(buildInlinedSkillPrompt).join('\n\n')
      : undefined;

    // Extract image attachments (with base64 data) for vision-capable models
    const imageAtts: CoworkImageAttachment[] = [];
    for (const attachment of attachments) {
      if (attachment.isImage && attachment.dataUrl) {
        const extracted = extractBase64FromDataUrl(attachment.dataUrl);
        if (extracted) {
          imageAtts.push({
            name: attachment.name,
            mimeType: extracted.mimeType,
            base64Data: extracted.base64Data,
          });
        }
      }
    }

    // Build prompt with ALL attachments that have real file paths (both regular files and images).
    // Image attachments also need their file paths in the prompt so the model knows
    // where the original files are located (e.g., for skills like seedream that need --image <path>).
    // Note: inline/clipboard images have pseudo-paths starting with 'inline:' and are excluded.
    const attachmentLines = attachments
      .filter((a) => !a.path.startsWith('inline:'))
      .map((attachment) => `${INPUT_FILE_LABEL}: ${attachment.path}`)
      .join('\n');
    const finalPrompt = trimmedValue
      ? (attachmentLines ? `${trimmedValue}\n\n${attachmentLines}` : trimmedValue)
      : attachmentLines;

    if (imageAtts.length > 0) {
      console.log('[CoworkPromptInput] handleSubmit: passing imageAtts to onSubmit', {
        count: imageAtts.length,
        names: imageAtts.map(a => a.name),
        base64Lengths: imageAtts.map(a => a.base64Data.length),
      });
    }
    const result = await onSubmit(finalPrompt, skillPrompt, imageAtts.length > 0 ? imageAtts : undefined);
    if (result === false) return;
    setValue('');
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
    dispatch(clearDraftAttachments(draftKey));
    setImageVisionHint(false);
  }, [value, isStreaming, disabled, onSubmit, activeSkillIds, skills, attachments, showFolderSelector, workingDirectory, dispatch]);

  const handleSelectSkill = useCallback((skill: Skill) => {
    dispatch(toggleActiveSkill(skill.id));
  }, [dispatch]);

  const handleManageSkills = useCallback(() => {
    if (onManageSkills) {
      onManageSkills();
    }
  }, [onManageSkills]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const currentShortcut = sendShortcutRef.current;
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key === 'Enter' && !isComposing) {
      if (currentShortcut === 'enter') {
        // Enter to submit, any modifier+Enter for new line
        const hasModifier = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
        if (!hasModifier && !isStreaming && !disabled) {
          event.preventDefault();
          handleSubmit();
        } else if (hasModifier && !event.shiftKey) {
          // Shift+Enter already inserts newline natively; for Ctrl/Cmd/Alt+Enter, insert via execCommand to preserve undo history
          event.preventDefault();
          document.execCommand('insertText', false, '\n');
        }
      } else if (currentShortcut === 'ctrlEnter') {
        // ctrlEnter mode: Ctrl/Cmd+Enter to submit, Enter for new line
        const useCtrlEnter = event.ctrlKey || event.metaKey;
        if (useCtrlEnter && !isStreaming && !disabled) {
          event.preventDefault();
          handleSubmit();
        }
        // Enter without modifier will naturally insert a new line
      } else {
        // Custom shortcut mode - parse the custom shortcut
        const shortcutParts = currentShortcut.toLowerCase().split('+').map(s => s.trim());
        const hasCtrl = shortcutParts.includes('ctrl') || shortcutParts.includes('cmd') || shortcutParts.includes('⌘');
        const hasAlt = shortcutParts.includes('alt') || shortcutParts.includes('option');
        const hasShift = shortcutParts.includes('shift');
        const hasMeta = shortcutParts.includes('meta') || shortcutParts.includes('cmd') || shortcutParts.includes('⌘');
        
        const keyMatch = shortcutParts.find(part => 
          !['ctrl', 'cmd', '⌘', 'alt', 'option', 'shift', 'meta'].includes(part)
        );
        
        if (keyMatch) {
          const matchesCtrl = hasCtrl === (event.ctrlKey || event.metaKey);
          const matchesAlt = hasAlt === event.altKey;
          const matchesShift = hasShift === event.shiftKey;
          const matchesKey = event.key.toLowerCase() === keyMatch;
          
          if (matchesCtrl && matchesAlt && matchesShift && matchesKey && !isStreaming && !disabled) {
            event.preventDefault();
            handleSubmit();
          }
        }
      }
    } else if (currentShortcut && currentShortcut !== 'enter' && currentShortcut !== 'ctrlEnter') {
      // Handle non-Enter custom shortcuts (e.g., Ctrl+S)
      const shortcutParts = currentShortcut.toLowerCase().split('+').map(s => s.trim());
      const hasCtrl = shortcutParts.includes('ctrl') || shortcutParts.includes('cmd') || shortcutParts.includes('⌘');
      const hasAlt = shortcutParts.includes('alt') || shortcutParts.includes('option');
      const hasShift = shortcutParts.includes('shift');
      
      const keyMatch = shortcutParts.find(part => 
        !['ctrl', 'cmd', '⌘', 'alt', 'option', 'shift', 'meta'].includes(part)
      );
      
      if (keyMatch && event.key.toLowerCase() === keyMatch) {
        const matchesCtrl = hasCtrl === (event.ctrlKey || event.metaKey);
        const matchesAlt = hasAlt === event.altKey;
        const matchesShift = hasShift === event.shiftKey;
        
        if (matchesCtrl && matchesAlt && matchesShift && !isStreaming && !disabled) {
          event.preventDefault();
          handleSubmit();
        }
      }
    }
  }, [isStreaming, disabled, handleSubmit]);

  const handleStopClick = () => {
    if (onStop) {
      onStop();
    }
  };

  const containerClass = isLarge
    ? 'relative rounded-2xl border border-border bg-surface shadow-card focus-within:shadow-elevated focus-within:ring-1 focus-within:ring-primary/40 focus-within:border-primary'
    : 'relative flex items-end gap-2 p-3 rounded-xl border border-border bg-surface';

  const textareaClass = isLarge
    ? `w-full resize-none bg-transparent px-4 pt-2.5 pb-2 text-foreground placeholder:dark:text-foregroundSecondary/60 placeholder:text-secondary/60 focus:outline-none text-[15px] leading-6 min-h-[${minHeight}px] max-h-[${maxHeight}px]`
    : 'flex-1 resize-none bg-transparent text-foreground placeholder:placeholder:text-secondary focus:outline-none text-sm leading-relaxed min-h-[24px] max-h-[200px]';

  const truncatePath = (path: string, maxLength = 30): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  const handleFolderSelect = (path: string) => {
    if (onWorkingDirectoryChange) {
      onWorkingDirectoryChange(path);
    }
  };

  const selectedModel = useSelector((state: RootState) => state.model.selectedModel);
  const modelSupportsImage = !!selectedModel?.supportsImage;

  const addAttachment = useCallback((filePath: string, imageInfo?: { isImage: boolean; dataUrl?: string }) => {
    if (!filePath) return;
    const current = attachments;
    if (current.some((attachment) => attachment.path === filePath)) return;
    dispatch(setDraftAttachments({
      draftKey,
      attachments: [...current, {
        path: filePath,
        name: getFileNameFromPath(filePath),
        isImage: imageInfo?.isImage,
        dataUrl: imageInfo?.dataUrl,
      }],
    }));
  }, [attachments, dispatch, draftKey]);

  const addImageAttachmentFromDataUrl = useCallback((name: string, dataUrl: string) => {
    // Use the dataUrl as the unique key (no file path for inline images)
    const pseudoPath = `inline:${name}:${Date.now()}`;
    dispatch(setDraftAttachments({
      draftKey,
      attachments: [...attachments, {
        path: pseudoPath,
        name,
        isImage: true,
        dataUrl,
      }],
    }));
  }, [attachments, dispatch, draftKey]);

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const getNativeFilePath = useCallback((file: File): string | null => {
    const maybePath = (file as File & { path?: string }).path;
    if (typeof maybePath === 'string' && maybePath.trim()) {
      return maybePath;
    }
    return null;
  }, []);

  const saveInlineFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const dataBase64 = await fileToBase64(file);
      if (!dataBase64) {
        return null;
      }
      const result = await window.electron.dialog.saveInlineFile({
        dataBase64,
        fileName: file.name,
        mimeType: file.type,
        cwd: workingDirectory,
      });
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('Failed to save inline file:', error);
      return null;
    }
  }, [fileToBase64, workingDirectory]);

  const handleIncomingFiles = useCallback(async (fileList: FileList | File[]) => {
    if (disabled || isStreaming) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    let hasImageWithoutVision = false;
    for (const file of files) {
      const nativePath = getNativeFilePath(file);

      // Check if this is an image file and model supports images
      const fileIsImage = nativePath
        ? isImagePath(nativePath)
        : isImageMimeType(file.type);

      if (fileIsImage) {
        if (modelSupportsImage) {
          // For images on vision-capable models, read as data URL
          if (nativePath) {
            try {
              const result = await window.electron.dialog.readFileAsDataUrl(nativePath);
              if (result.success && result.dataUrl) {
                addAttachment(nativePath, { isImage: true, dataUrl: result.dataUrl });
                continue;
              }
            } catch (error) {
              console.error('Failed to read image as data URL:', error);
            }
            // Fallback: add as regular file attachment
            addAttachment(nativePath);
          } else {
            // No native path (clipboard/drag from browser) - read via FileReader
            try {
              const dataUrl = await fileToDataUrl(file);
              addImageAttachmentFromDataUrl(file.name, dataUrl);
            } catch (error) {
              console.error('Failed to read image from clipboard:', error);
              const stagedPath = await saveInlineFile(file);
              if (stagedPath) {
                addAttachment(stagedPath);
              }
            }
          }
          continue;
        }
        // Model doesn't support image input — add as file path and show hint
        hasImageWithoutVision = true;
      }

      // Non-image file or model doesn't support images: use original flow
      if (nativePath) {
        addAttachment(nativePath);
        continue;
      }

      const stagedPath = await saveInlineFile(file);
      if (stagedPath) {
        addAttachment(stagedPath);
      }
    }
    if (hasImageWithoutVision) {
      setImageVisionHint(true);
    }
  }, [addAttachment, addImageAttachmentFromDataUrl, disabled, fileToDataUrl, getNativeFilePath, isStreaming, modelSupportsImage, saveInlineFile]);

  const handleAddFile = useCallback(async () => {
    if (isAddingFile || disabled || isStreaming) return;
    setIsAddingFile(true);
    try {
      const result = await window.electron.dialog.selectFiles({
        title: i18nService.t('coworkAddFile'),
      });
      if (!result.success || result.paths.length === 0) return;
      let hasImageWithoutVision = false;
      for (const filePath of result.paths) {
        if (isImagePath(filePath)) {
          if (modelSupportsImage) {
            try {
              const readResult = await window.electron.dialog.readFileAsDataUrl(filePath);
              if (readResult.success && readResult.dataUrl) {
                addAttachment(filePath, { isImage: true, dataUrl: readResult.dataUrl });
                continue;
              }
            } catch (error) {
              console.error('Failed to read image as data URL:', error);

            }
          } else {
            hasImageWithoutVision = true;
          }
        }
        addAttachment(filePath);
      }
      if (hasImageWithoutVision) {
        setImageVisionHint(true);

      }
    } catch (error) {
      console.error('Failed to select file:', error);
    } finally {
      setIsAddingFile(false);
    }
  }, [addAttachment, isAddingFile, disabled, isStreaming, modelSupportsImage]);

  const handleRemoveAttachment = useCallback((path: string) => {
    dispatch(setDraftAttachments({
      draftKey,
      attachments: attachments.filter((attachment) => attachment.path !== path),
    }));
  }, [attachments, dispatch, draftKey]);

  const hasFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.files.length > 0) return true;
    return Array.from(dataTransfer.types).includes('Files');
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!disabled && !isStreaming) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled || isStreaming ? 'none' : 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled || isStreaming) return;
    void handleIncomingFiles(event.dataTransfer.files);
  };

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isStreaming) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void handleIncomingFiles(files);
  }, [disabled, handleIncomingFiles, isStreaming]);

  const canSubmit = !disabled && (!!value.trim() || attachments.length > 0);
  const enhancedContainerClass = isDraggingFiles
    ? `${containerClass} ring-2 ring-primary/50 border-primary/60`
    : containerClass;

  // Determine platform for shortcut display
  const isMac = typeof window !== 'undefined' && window.electron?.platform === 'darwin';

  // Send button with dropdown
  const renderSendButton = () => {
    const baseButtonClass = isLarge
      ? 'p-2 rounded-xl transition-all shadow-subtle hover:shadow-card active:scale-95'
      : 'flex-shrink-0 p-2 rounded-lg transition-all shadow-subtle hover:shadow-card active:scale-95';
    
    const enabledButtonClass = 'bg-primary hover:bg-primary-hover text-white';
    const disabledButtonClass = 'bg-primary/50 text-white/70 cursor-not-allowed';

    if (isStreaming) {
      return (
        <button
          type="button"
          onClick={handleStopClick}
          className={`${baseButtonClass} bg-red-500 hover:bg-red-600 text-white`}
          aria-label="Stop"
        >
          <StopIcon className={isLarge ? 'h-5 w-5' : 'h-4 w-4'} />
        </button>
      );
    }

    return (
      <div className="flex items-center relative">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`${baseButtonClass} ${canSubmit ? enabledButtonClass : disabledButtonClass} rounded-r-none`}
          aria-label="Send"
        >
          <PaperAirplaneIcon className={isLarge ? 'h-5 w-5' : 'h-4 w-4'} />
        </button>
        <button
          ref={shortcutButtonRef}
          type="button"
          onClick={() => setShowShortcutMenu(!showShortcutMenu)}
          disabled={disabled}
          className={`${baseButtonClass} ${canSubmit ? enabledButtonClass : disabledButtonClass} rounded-l-none border-l border-white/20`}
          aria-label="Send options"
          title={i18nService.t('sendMessageShortcut')}
        >
          <ChevronDownIcon className={isLarge ? 'h-4 w-4' : 'h-3 w-3'} />
        </button>
        {showShortcutMenu && (
          <div 
            className={`fixed ${isLarge ? 'bottom-[80px] right-[20px]' : 'bottom-[60px] right-[20px]'} w-56 rounded-xl border border-border bg-surface shadow-elevated py-1`}
            style={{ zIndex: 99999 }}
          >
            <button
              type="button"
              onClick={(e) => {
                console.log('[CoworkPromptInput] Enter option clicked');
                e.stopPropagation();
                e.preventDefault();
                handleShortcutChange('enter');
              }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-surface-raised transition-colors flex items-center justify-between ${sendShortcut === 'enter' ? 'text-primary' : 'text-foreground'}`}
            >
              <span>{i18nService.t('sendMessageShortcutEnter')}</span>
              {sendShortcut === 'enter' && (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                console.log('[CoworkPromptInput] Ctrl+Enter option clicked');
                e.stopPropagation();
                e.preventDefault();
                handleShortcutChange('ctrlEnter');
              }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-surface-raised transition-colors flex items-center justify-between ${sendShortcut === 'ctrlEnter' ? 'text-primary' : 'text-foreground'}`}
            >
              <span>{isMac ? i18nService.t('sendMessageShortcutCmdEnter') : i18nService.t('sendMessageShortcutCtrlEnter')}</span>
              {sendShortcut === 'ctrlEnter' && (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            
            {/* Show custom shortcut option if user has set a custom shortcut */}
            {customShortcutDisplay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleShortcutChange(customShortcutDisplay as AppConfig['sendMessageShortcut']);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-surface-raised transition-colors flex items-center justify-between ${(sendShortcut !== 'enter' && sendShortcut !== 'ctrlEnter') ? 'text-primary' : 'text-foreground'}`}
              >
                <span className="flex items-center gap-2">
                  <span>{i18nService.t('shortcutNotSet')}</span>
                  <span className="text-xs text-secondary bg-surface-raised px-1.5 py-0.5 rounded">{customShortcutDisplay}</span>
                </span>
                {(sendShortcut !== 'enter' && sendShortcut !== 'ctrlEnter') && (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
              <div
                key={attachment.path}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground max-w-full"
                title={attachment.path}
              >
                {attachment.isImage ? (
                  <PhotoIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                ) : (
                  <PaperClipIcon className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span className="truncate max-w-[180px]">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(attachment.path)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-surface-raised"
                  aria-label={i18nService.t('coworkAttachmentRemove')}
                  title={i18nService.t('coworkAttachmentRemove')}
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </div>
          ))}
        </div>
      )}
      {imageVisionHint && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <ExclamationTriangleIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {i18nService.getLanguage() === 'zh'
              ? '当前模型未启用图片输入，图片将以文件路径形式发送。若该模型本身支持图片理解，可在模型配置中开启图片输入选项。'
              : 'Image input is not enabled for the current model. Images will be sent as file paths. If the model supports vision, you can enable image input in the model configuration.'}
          </span>
          <button
            type="button"
            onClick={() => setImageVisionHint(false)}
            className="ml-auto flex-shrink-0 rounded-full p-0.5 hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </div>
      )}
      <div
        className={enhancedContainerClass}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-primary/10 text-xs font-medium text-primary">
            {i18nService.t('coworkDropFileHint')}
          </div>
        )}
        {isLarge ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled}
              rows={isLarge ? 2 : 1}
              className={textareaClass}
              style={{ minHeight: `${minHeight}px` }}
            />
            <div className="flex items-center justify-between px-4 pb-2 pt-1.5">
              <div className="flex items-center gap-2 relative">
                {showFolderSelector && (
                  <>
                    <div className="relative group">
                      <button
                        ref={folderButtonRef as React.RefObject<HTMLButtonElement>}
                        type="button"
                        onClick={() => setShowFolderMenu(!showFolderMenu)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
                      >
                        <FolderIcon className="h-4 w-4" />
                        <span className="max-w-[150px] truncate text-xs">
                          {truncatePath(workingDirectory)}
                        </span>
                      </button>
                      {/* Tooltip - hidden when folder menu is open */}
                      {!showFolderMenu && (
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl shadow-xl bg-background text-foreground border-border border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50 max-w-[400px] break-all whitespace-nowrap">
                          {truncatePath(workingDirectory, 120)}
                        </div>
                      )}
                    </div>
                    <FolderSelectorPopover
                      isOpen={showFolderMenu}
                      onClose={() => setShowFolderMenu(false)}
                      onSelectFolder={handleFolderSelect}
                      anchorRef={folderButtonRef as React.RefObject<HTMLElement>}
                    />
                  </>
                )}
                {showModelSelector && !remoteManaged && <ModelSelector dropdownDirection="up" />}
                {!remoteManaged && (
                  <button
                    type="button"
                    onClick={handleAddFile}
                    className="flex items-center justify-center p-1.5 rounded-lg text-sm text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
                    title={i18nService.t('coworkAddFile')}
                    aria-label={i18nService.t('coworkAddFile')}
                    disabled={disabled || isStreaming || isAddingFile}
                  >
                    <PaperClipIcon className="h-4 w-4" />
                  </button>
                )}
                {!remoteManaged && (
                  <>
                    <SkillsButton
                      onSelectSkill={handleSelectSkill}
                      onManageSkills={handleManageSkills}
                    />
                    <ActiveSkillBadge />
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {renderSendButton()}
              </div>
            </div>
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className={textareaClass}
            />

            {!remoteManaged && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddFile}
                  className="flex-shrink-0 p-1.5 rounded-lg text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
                  title={i18nService.t('coworkAddFile')}
                  aria-label={i18nService.t('coworkAddFile')}
                  disabled={disabled || isStreaming || isAddingFile}
                >
                  <PaperClipIcon className="h-4 w-4" />
                </button>
              </div>
            )}

            {renderSendButton()}
          </>
        )}
      </div>
      {showFolderRequiredWarning && (
        <div className="mt-2 text-xs text-red-500 dark:text-red-400">
          {i18nService.t('coworkSelectFolderFirst')}
        </div>
      )}
    </div>
  );
  }
);

CoworkPromptInput.displayName = 'CoworkPromptInput';

export default CoworkPromptInput;
