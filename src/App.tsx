import { Navigate, Route, Routes } from 'react-router-dom';
import { BattleApp } from './components/BattleApp';
import { HomePage } from './pages/HomePage';
import { PracticePage } from './pages/PracticePage';
import { PracticeDetailPage } from './pages/PracticeDetailPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/battle" element={<BattleApp />} />
      <Route path="/practice" element={<PracticePage />} />
      <Route path="/practice/item" element={<PracticeDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
