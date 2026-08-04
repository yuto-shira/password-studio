import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import reactGuide from '../docs/REACT_GUIDE.md?raw'

// パスワード生成画面でユーザーが指定できる条件をまとめた型。
// チェックボックスの値もこのオブジェクトに集約し、条件の受け渡しを分かりやすくする。
type PasswordOptions = {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  excludeSimilar: boolean
  customWord: string
}

// Local Storageへ保存する1件分のデータ。
// パスワードだけでなく用途名と保存日を持たせ、一覧で識別できるようにする。
type SavedPassword = {
  id: string
  label: string
  password: string
  createdAt: string
}

// toggleOptionへ渡せるプロパティをチェックボックス項目だけに限定する。
// 文字数や任意ワードを誤って真偽値で更新することをTypeScriptで防止する。
type OptionKey = 'uppercase' | 'lowercase' | 'numbers' | 'symbols' | 'excludeSimilar'

// 保存場所を一元管理するためのキー。別アプリのLocal Storageと名前が衝突しない名称にする。
const STORAGE_KEY = 'password-studio-items'

// オプションごとに使用できる文字を定義する。
// 記号はWebサービスで比較的利用しやすいものに絞っている。
const characterSets = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*_-+=?',
}

// 見た目が似ていて読み間違えやすい文字。除外設定が有効な場合のみ候補から取り除く。
const similarCharacters = new Set(['0', 'O', 'o', '1', 'I', 'i', 'l'])

/**
 * 0以上max未満の整数を、Web Crypto APIを使用して返す。
 * Math.random()はパスワード用途には予測されやすいため使用しない。
 * また、単純な剰余で生じる値の偏りを避けるため、割り切れない範囲の乱数は再取得する。
 */
function secureIndex(max: number) {
  if (max <= 0) return 0
  const limit = Math.floor(0x100000000 / max) * max
  const buffer = new Uint32Array(1)
  do crypto.getRandomValues(buffer)
  while (buffer[0] >= limit)
  return buffer[0] % max
}

/**
 * Fisher-Yates法で文字列をシャッフルする。
 * 指定ワードや各文字種の必須文字が特定位置に固まらないよう、完成直前に並び替える。
 */
function shuffle(value: string) {
  const characters = [...value]
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const randomIndex = secureIndex(index + 1)
    ;[characters[index], characters[randomIndex]] = [characters[randomIndex], characters[index]]
  }
  return characters.join('')
}

/**
 * ブラウザに保存済みのデータを初期表示用に読み込む。
 * 不正なJSONなどで読み込みに失敗しても画面を停止させず、空配列から開始する。
 */
function readSavedPasswords(): SavedPassword[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedPassword[]
  } catch {
    return []
  }
}

function PasswordApp() {
  // 生成条件。初期状態では一般的な4種類の文字をすべて利用する。
  const [options, setOptions] = useState<PasswordOptions>({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeSimilar: true,
    customWord: '',
  })

  // 生成結果、保存時の用途名、保存済みデータ、表示中のID、通知文を個別に管理する。
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState('')
  const [savedPasswords, setSavedPasswords] = useState<SavedPassword[]>(readSavedPasswords)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')

  // 文字種が1つも選択されていない場合は生成ボタンを無効化するため、選択数を求める。
  const selectedCount = [options.uppercase, options.lowercase, options.numbers, options.symbols].filter(Boolean).length

  // 文字数と含まれる文字種から簡易的な強度を算出する。
  // passwordが変化したときだけ再計算するためuseMemoを使用する。
  const strength = useMemo(() => {
    let score = 0
    if (password.length >= 12) score += 1
    if (password.length >= 18) score += 1
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
    if (/\d/.test(password) && /[^a-zA-Z\d]/.test(password)) score += 1
    if (score >= 4) return { label: 'とても強い', level: 4 }
    if (score >= 3) return { label: '強い', level: 3 }
    if (score >= 2) return { label: '普通', level: 2 }
    return { label: '弱い', level: 1 }
  }, [password])

  // 保存済み一覧が更新されるたびにLocal Storageへ同期する。
  // JSON文字列に変換することで、配列の構造を維持したまま保存できる。
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPasswords))
  }, [savedPasswords])

  // 操作結果を画面右下へ短時間表示し、コピーや保存が成功したことをユーザーへ伝える。
  const notify = (text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 1800)
  }

  // 指定されたチェックボックス項目だけを反転し、それ以外の生成条件は維持する。
  const toggleOption = (key: OptionKey) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }))
  }

  /**
   * 現在の条件からパスワードを生成するメイン処理。
   * 1. 有効な文字セットを抽出し、必要なら紛らわしい文字を除外する。
   * 2. 選択した各文字種から最低1文字ずつ確保する。
   * 3. 残りの長さを全候補から安全な乱数で補う。
   * 4. 任意ワードを結合した後、位置が推測されにくいよう全体をシャッフルする。
   */
  const generatePassword = () => {
    const enabledSets = (Object.keys(characterSets) as Array<keyof typeof characterSets>)
      .filter((key) => options[key])
      .map((key) => characterSets[key])
      .map((set) => options.excludeSimilar ? [...set].filter((character) => !similarCharacters.has(character)).join('') : set)

    if (enabledSets.length === 0) {
      notify('文字の種類を1つ以上選択してください')
      return
    }

    // 前後の空白は入力ミスとみなし除去する。スプレッド構文で絵文字なども1文字単位に数える。
    const customWord = options.customWord.trim()
    if ([...customWord].length > options.length) {
      notify('指定ワードより長い文字数を設定してください')
      return
    }

    // 各文字種を最低1文字含めることで、チェックしたのに結果へ含まれない状況を防ぐ。
    const allCharacters = enabledSets.join('')
    const requiredCharacters = enabledSets.map((set) => set[secureIndex(set.length)])
    const availableLength = options.length - [...customWord].length
    let generated = requiredCharacters.slice(0, availableLength).join('')
    while ([...generated].length < availableLength) {
      generated += allCharacters[secureIndex(allCharacters.length)]
    }
    setPassword(shuffle(`${generated}${customWord}`))
    setLabel('')
  }

  // Clipboard APIへ値を書き込み、成功したことをトースト通知する。
  const copyPassword = async (value: string) => {
    await navigator.clipboard.writeText(value)
    notify('クリップボードにコピーしました')
  }

  // 生成結果へ一意なIDと保存日を付け、一覧の先頭へ追加する。
  // 用途名が未入力でも保存できるよう、表示用の既定値を設定する。
  const savePassword = () => {
    if (!password) return
    setSavedPasswords((current) => [{
      id: crypto.randomUUID(),
      label: label.trim() || '名前なし',
      password,
      createdAt: new Intl.DateTimeFormat('ja-JP').format(new Date()),
    }, ...current])
    setLabel('')
    notify('このブラウザに保存しました')
  }

  // 対象IDのデータを保存一覧から取り除き、表示状態の管理対象からも削除する。
  const deletePassword = (id: string) => {
    setSavedPasswords((current) => current.filter((item) => item.id !== id))
    setVisibleIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  // SetにIDがあれば非表示へ、なければ表示へ切り替える。
  // Reactの状態を直接変更しないよう、新しいSetを作ってから更新する。
  const toggleVisibility = (id: string) => {
    setVisibleIds((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <main>
      <header className="hero">
        <div className="brand-mark" aria-hidden="true">P</div>
        <div>
          <p className="eyebrow">SECURE PASSWORD GENERATOR</p>
          <h1>Password Studio</h1>
          <p className="subtitle">あなただけの強いパスワードを、シンプルに。</p>
        </div>
        <a className="guide-link" href="/guide">React解説を読む →</a>
      </header>

      <div className="notice"><span>i</span><p><strong>学習用デモアプリです</strong>保存内容は暗号化されません。実際のパスワードは保存しないでください。</p></div>

      <section className="workspace">
        <div className="panel settings-panel">
          <div className="section-title"><span>01</span><div><h2>生成オプション</h2><p>パスワードの条件を設定します</p></div></div>

          <div className="length-control">
            <div className="label-row"><label htmlFor="length">文字数</label><output>{options.length}</output></div>
            <input id="length" type="range" min="8" max="64" value={options.length} onChange={(event) => setOptions({ ...options, length: Number(event.target.value) })} />
            <div className="range-labels"><span>8</span><span>64</span></div>
          </div>

          <fieldset>
            <legend>使用する文字</legend>
            <div className="option-grid">
              {([
                ['uppercase', '英大文字', 'A–Z'],
                ['lowercase', '英小文字', 'a–z'],
                ['numbers', '数字', '0–9'],
                ['symbols', '記号', '!@#'],
              ] as const).map(([key, title, sample]) => (
                <label className={`option-card ${options[key] ? 'selected' : ''}`} key={key}>
                  <input type="checkbox" checked={options[key]} onChange={() => toggleOption(key)} />
                  <span className="fake-checkbox">✓</span><span><strong>{title}</strong><small>{sample}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="inline-option"><input type="checkbox" checked={options.excludeSimilar} onChange={() => toggleOption('excludeSimilar')} /><span className="fake-checkbox">✓</span><span><strong>紛らわしい文字を除外</strong><small>0, O, o, 1, I, i, l</small></span></label>

          <div className="field">
            <label htmlFor="customWord">含めたいワード <span>任意</span></label>
            <input id="customWord" type="text" maxLength={30} placeholder="例：sakura" value={options.customWord} onChange={(event) => setOptions({ ...options, customWord: event.target.value })} />
            <small>指定した文字列をパスワード内にランダム配置します</small>
          </div>

          <button className="generate-button" onClick={generatePassword} disabled={selectedCount === 0}><span aria-hidden="true">✦</span> パスワードを生成</button>
        </div>

        <div className="right-column">
          <section className="panel result-panel">
            <div className="section-title"><span>02</span><div><h2>生成結果</h2><p>安全な乱数で生成されます</p></div></div>
            {password ? <>
              <div className="password-result">
                <code>{password}</code>
                {/* アイコンだけのボタンにはaria-labelとtitleを付け、読み上げとホバー表示の両方に対応する。 */}
                <button
                  aria-label="生成したパスワードをコピー"
                  title="パスワードをコピー"
                  onClick={() => copyPassword(password)}
                >▣</button>
              </div>
              <div className="strength-row"><span>強度</span><div className="strength-bars">{[1, 2, 3, 4].map((level) => <i className={level <= strength.level ? 'active' : ''} key={level} />)}</div><strong>{strength.label}</strong></div>
              <div className="save-row"><input aria-label="保存名" placeholder="用途・サービス名（例：GitHub）" value={label} onChange={(event) => setLabel(event.target.value)} /><button onClick={savePassword}>保存する</button></div>
            </> : <div className="empty-result"><span>✦</span><p>オプションを設定して<br />パスワードを生成してください</p></div>}
          </section>

          <section className="panel saved-panel">
            <div className="section-title saved-title"><span>03</span><div><h2>保存済み</h2><p>このブラウザにのみ保存されます</p></div><b>{savedPasswords.length}</b></div>
            {savedPasswords.length === 0 ? <div className="empty-saved"><span>▱</span><p>保存したパスワードはここに表示されます</p></div> : <div className="saved-list">
              {savedPasswords.map((item) => <article className="saved-item" key={item.id}>
                <div><strong>{item.label}</strong><small>{item.createdAt}</small></div>
                <code>{visibleIds.has(item.id) ? item.password : '••••••••••••'}</code>
                <div className="item-actions">
                  {/* 現在の状態に合わせて、次に実行される処理をツールチップへ表示する。 */}
                  <button
                    aria-label={visibleIds.has(item.id) ? 'パスワードを非表示にする' : 'パスワードを表示する'}
                    title={visibleIds.has(item.id) ? 'パスワードを隠す' : 'パスワードを表示'}
                    onClick={() => toggleVisibility(item.id)}
                  >{visibleIds.has(item.id) ? '●' : '◉'}</button>
                  <button
                    aria-label={`${item.label}のパスワードをコピー`}
                    title="パスワードをコピー"
                    onClick={() => copyPassword(item.password)}
                  >▣</button>
                  <button
                    className="delete"
                    aria-label={`${item.label}の保存データを削除`}
                    title="保存データを削除"
                    onClick={() => deletePassword(item.id)}
                  >×</button>
                </div>
              </article>)}
            </div>}
          </section>
        </div>
      </section>
      <footer>Built with React + TypeScript <span>•</span> Randomized by Web Crypto API</footer>
      {message && <div className="toast" role="status">{message}</div>}
    </main>
  )
}

/**
 * Markdownで管理しているReact解説資料をブラウザ用のHTMLへ変換して表示する。
 * 資料本体を直接読み込むため、Markdownを更新するとこのページにも同じ内容が反映される。
 */
function GuidePage() {
  return (
    <div className="guide-page">
      <nav className="guide-nav">
        <a href="/">← Password Studioへ戻る</a>
        <span>React Learning Guide</span>
      </nav>
      <article className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{reactGuide}</ReactMarkdown>
      </article>
      <a className="back-to-app" href="/">Password Studioへ戻る</a>
    </div>
  )
}

/**
 * URLに応じて表示するページを切り替える簡易ルーター。
 * 今回は2画面だけなので外部ルーターを使わず、/guideの場合だけ解説ページを表示する。
 */
function App() {
  return window.location.pathname === '/guide' ? <GuidePage /> : <PasswordApp />
}

export default App
