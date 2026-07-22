import { Link } from 'react-router-dom'
import './Home.css'

function FlowPreview() {
  return (
    <svg className="home-flow-svg" viewBox="0 0 560 220" role="presentation" aria-hidden="true">
      <defs>
        <marker id="home-arrow" markerWidth="8" markerHeight="8" refX="6" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L7,2.5 z" fill="var(--text)" />
        </marker>
      </defs>

      <circle cx="40" cy="110" r="16" fill="none" stroke="var(--text)" strokeWidth="1.5" />

      <line x1="56" y1="110" x2="118" y2="110" stroke="var(--text)" strokeWidth="1.5" markerEnd="url(#home-arrow)" />
      <rect x="122" y="86" width="110" height="48" rx="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="1.5" />
      <text x="177" y="114" textAnchor="middle" className="home-flow-label">受付処理</text>

      <line x1="232" y1="110" x2="294" y2="110" stroke="var(--text)" strokeWidth="1.5" markerEnd="url(#home-arrow)" />
      <rect x="298" y="86" width="110" height="48" rx="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="1.5" />
      <text x="353" y="114" textAnchor="middle" className="home-flow-label">承認待ち</text>

      <line x1="408" y1="110" x2="470" y2="110" stroke="var(--text)" strokeWidth="1.5" markerEnd="url(#home-arrow)" />
      <circle cx="500" cy="110" r="16" fill="none" stroke="var(--text)" strokeWidth="3" />

      <rect
        x="286"
        y="72"
        width="134"
        height="76"
        rx="10"
        fill="none"
        stroke="#e11d48"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text x="353" y="60" textAnchor="middle" className="home-flow-issue">課題：待ち時間が長い</text>

      <rect
        x="110"
        y="150"
        width="222"
        height="48"
        rx="10"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text x="221" y="184" textAnchor="middle" className="home-flow-improve">改善：承認を自動化して短縮</text>
    </svg>
  )
}

function Home() {
  return (
    <>
      <section className="home-hero">
        <span className="home-badge">AI × 業務フロー改善</span>
        <h1>
          フローを描くだけで、
          <br />
          AIが業務改善を提案する。
        </h1>
        <p className="home-lead">
          現在の業務フローを図にするだけで、AIが課題を見つけ、改善後のフローまで一緒に考えてくれます。
        </p>
        <Link to="/editor" className="home-cta">
          フロー図エディタを開く →
        </Link>
      </section>

      <section className="home-preview">
        <div className="home-preview-card">
          <FlowPreview />
        </div>
      </section>

      <section className="home-steps">
        <div className="home-steps-inner">
          <div className="home-step">
            <div className="home-step-num">1</div>
            <h2>現在フロー</h2>
            <p>スイムレーンやタスクを配置して、今の業務の流れをそのまま図にします。</p>
          </div>
          <div className="home-step">
            <div className="home-step-num">2</div>
            <h2>課題付与フロー</h2>
            <p>フローをAIに送るだけで、ボトルネックや無駄な工程を赤枠で指摘してもらえます。</p>
          </div>
          <div className="home-step">
            <div className="home-step-num">3</div>
            <h2>改善後フロー</h2>
            <p>AIが考えた改善後のフローと変更点を青枠で受け取り、そのまま取り込めます。</p>
          </div>
        </div>
      </section>
    </>
  )
}

export default Home
