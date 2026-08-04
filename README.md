# Password Studio

ReactとTypeScriptで制作した、学習用のパスワード生成アプリです。Web Crypto APIを利用してランダムなパスワードを生成します。

Reactの処理をコードに沿って学習する場合は、[Password Studioで学ぶReact入門](./docs/REACT_GUIDE.md)を参照してください。

## 機能

- 8〜64文字の文字数指定
- 英大文字・英小文字・数字・記号の選択
- 紛らわしい文字の除外
- 任意ワードの挿入
- パスワード強度の簡易表示
- クリップボードへのコピー
- 用途名を付けたブラウザ内保存、表示切り替え、削除
- スマートフォン対応

## 使用技術

- React
- TypeScript
- Vite
- Web Crypto API
- Local Storage API

## 起動方法

```bash
npm install
npm run dev
```

## セキュリティ上の注意

このアプリはフロントエンド学習用のデモです。保存内容は暗号化されず、ブラウザのLocal Storageに保存されます。実際に使用しているパスワードは入力・保存しないでください。
