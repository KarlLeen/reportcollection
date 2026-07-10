import { type ReactNode } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import BonkReport from "./BonkReport";
import GitcoinReport from "./GitcoinReport";
import "./App.css";

function Home() {
  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">report collection</p>
          <h1>DAO governance reports</h1>
          <p className="subhead">
            Interactive voting-power dashboards in the style of on-chain governance distribution
            reports (RPL pDAO template).
          </p>
        </div>
      </header>
      <section className="grid-2">
        <a className="card home-card" href="/bonk">
          <h2>Bonk DAO</h2>
          <p className="caption">
            Solana Realms · BIP#76 treasury drain analysis · liquid quorum surface
          </p>
        </a>
        <a className="card home-card" href="/gitcoin">
          <h2>Gitcoin DAO</h2>
          <p className="caption">Ethereum Governor + Snapshot · GTC delegation · treasury signaling</p>
        </a>
      </section>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <nav className="topnav">
        <NavLink to="/" end>
          Reports
        </NavLink>
        <NavLink to="/bonk">Bonk</NavLink>
        <NavLink to="/gitcoin">Gitcoin</NavLink>
      </nav>
      {children}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bonk" element={<BonkReport />} />
          <Route path="/gitcoin" element={<GitcoinReport />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
