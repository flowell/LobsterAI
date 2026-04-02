# Design: Theme Name i18n (English Translation)

Date: 2026-04-02

## Problem

In the Settings panel (General > Color Themes), each theme tile displays its name via `t.meta.name` (`Settings.tsx:2465`). The `name` field is hardcoded as a Chinese string in each theme definition file (e.g., `'经典浅色'`). Switching the app language to English has no effect on these names — they always show in Chinese.

## Goal

When the app language is set to English, all 14 theme names in the Color Themes gallery should display in English.

## Approach: Add i18n keys by theme ID (Option A)

Add `theme-name-<id>` translation keys to `src/renderer/services/i18n.ts` for both `zh` and `en` locales. Update `Settings.tsx` to use `i18nService.t('theme-name-' + t.meta.id)` with a fallback to `t.meta.name` for safety.

This approach:
- Follows the existing centralized i18n key-value pattern.
- Touches only 2 files (`i18n.ts` and `Settings.tsx`).
- Leaves all 14 theme definition files and `ThemeMeta` type unchanged.

## Translation Table

| Theme ID       | Chinese (zh) | English (en)       |
|----------------|--------------|--------------------|
| classic-light  | 经典浅色     | Classic Light      |
| classic-dark   | 经典深色     | Classic Dark       |
| dawn           | 晨光蓝白     | Dawn               |
| daylight       | 日光暖白     | Daylight           |
| paper          | 纸墨素白     | Paper              |
| sakura         | 樱花粉白     | Sakura             |
| midnight       | 午夜深蓝     | Midnight           |
| ocean          | 深海蓝黑     | Ocean              |
| emerald        | 翡翠暗绿     | Emerald            |
| rose           | 玫瑰暗红     | Rose               |
| mocha          | 摩卡棕黑     | Mocha              |
| sunset         | 落日橙黑     | Sunset             |
| nord           | Nord 极光    | Nord Aurora        |
| cyber          | 赛博霓虹     | Cyber Neon         |

## Files Changed

1. `src/renderer/services/i18n.ts`
   - Add 14 `theme-name-<id>` keys to `zh` section.
   - Add 14 `theme-name-<id>` keys to `en` section.

2. `src/renderer/components/Settings.tsx`
   - Line 2465: change `{t.meta.name}` to `{i18nService.t('theme-name-' + t.meta.id) || t.meta.name}`.

## Testing

- Run `npm run electron:dev`, open Settings > General > Color Themes.
- Switch language to English: all 14 theme names should display in English.
- Switch language back to Chinese: all 14 theme names should display in Chinese.
