import { Link } from 'react-router-dom';
import { FaBrain, FaHistory, FaPlay, FaRobot } from 'react-icons/fa';
import { LogoMark } from '../components/LogoMark';

export function HomePage() {
  return (
    <main className="home-shell">
      <header className="home-nav">
        <Link to="/" className="home-brand" aria-label="Easy Go 主页">
          <LogoMark />
          <span>EASY GO</span>
        </Link>
      </header>

      <section className="home-hero">
        <span className="eyebrow">Browser-native Go · 浏览器原生围棋</span>
        <div className="home-logo-wrap">
          <LogoMark className="home-logo" />
        </div>
        <h1>EASY GO</h1>
        <p>
          无需安装、无需服务器。在浏览器里直接与 KataGo 对弈，落子即算，随时查看胜率与推荐落点，
          让每一盘棋都能立即练习与复盘。
        </p>

        <div className="home-features" aria-label="Easy Go 核心功能">
          <section>
            <FaRobot aria-hidden="true" />
            <h2>与 KataGo 对战</h2>
            <p>KataGo 神经网络在本地运行，三档模型可选，走子即时分析。</p>
          </section>
          <section>
            <FaBrain aria-hidden="true" />
            <h2>即时胜率与推荐</h2>
            <p>落子后立刻给出双方胜率与推荐落点，提示还会随思考持续加深。</p>
          </section>
          <section>
            <FaHistory aria-hidden="true" />
            <h2>练习与复盘</h2>
            <p>对局练习与棋谱复盘正在建设中，即将上线。</p>
          </section>
        </div>

        <div className="home-actions">
          <Link to="/battle" className="primary-link">
            <FaPlay aria-hidden="true" />开始对战
          </Link>
          <button type="button" className="secondary-link" disabled>
            练习 · 即将上线
          </button>
          <button type="button" className="secondary-link" disabled>
            复盘 · 即将上线
          </button>
        </div>
      </section>
    </main>
  );
}
