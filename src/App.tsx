import { Navigate, Route, Routes } from 'react-router-dom';
import { BattleApp } from './components/BattleApp';
import { HomePage } from './pages/HomePage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/battle" element={<BattleApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
