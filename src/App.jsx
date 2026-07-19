import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home/Home'
import BpmnEditor from './pages/BpmnEditor/BpmnEditor'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/editor" element={<BpmnEditor />} />
    </Routes>
  )
}

export default App
