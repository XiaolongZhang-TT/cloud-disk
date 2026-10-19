import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Logo } from '../components/Logo'

export function NotFoundPage() {
  return (
    <div className="notfound-page">
      <Link to="/" className="notfound-brand">
        <Logo size={42} />
      </Link>
      <div className="notfound-icon">
        <Compass size={30} />
      </div>
      <p className="notfound-code">404</p>
      <h1>页面不存在</h1>
      <p className="notfound-desc">你访问的页面可能已被移动、删除，或者地址不完整。</p>
      <Link className="btn btn-primary" to="/">
        返回首页
      </Link>
    </div>
  )
}
