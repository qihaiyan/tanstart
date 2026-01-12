import { useCallback, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

/*
const loggingMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    console.log("Request:", request.url);
    return next();
  }
);
const loggedServerFunction = createServerFn({ method: "GET" }).middleware([
  loggingMiddleware,
]);
*/

// 数据库文件路径
const DB_FILE = 'todos.db'

// 封装数据库操作的函数，仅在服务器端执行
async function withDatabase<T>(fn: (db: any) => T): Promise<T> {
  // 动态导入，仅在服务器端执行
  const Database = (await import('better-sqlite3')).default
  const db = new Database(DB_FILE)
  
  try {
    // 初始化数据库表
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `)
    
    // 创建用户持仓表
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        avg_cost REAL NOT NULL,
        market_value REAL NOT NULL,
        profit REAL NOT NULL,
        profit_percent REAL NOT NULL,
        notes TEXT,
        position_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)
    
    // 创建用户表（如果不存在）
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // 检查是否已有数据
    const count = (db.prepare('SELECT COUNT(*) as count FROM todos').get() as { count: number }).count
    
    // 如果没有数据，插入一些示例数据
    if (count === 0) {
      const stmt = db.prepare('INSERT INTO todos (name) VALUES (?)')
      stmt.run('Get groceries')
      stmt.run('Buy a new phone')
    }
    
    return fn(db)
  } finally {
    // 确保数据库连接关闭
    db.close()
  }
}

// 注释掉未使用的todo函数
/*
async function readTodos() {
  return withDatabase((db) => {
    return db.prepare('SELECT * FROM todos ORDER BY id').all()
  })
}
*/

// 用户持仓相关函数
async function getUserPositions(userId: number) {
  return withDatabase((db) => {
    return db.prepare('SELECT * FROM user_positions WHERE user_id = ? ORDER BY id').all(userId)
  })
}

async function addUserPosition(position: {
  user_id: number,
  stock_id: string,
  symbol: string,
  stock_name: string,
  quantity: number,
  avg_cost: number,
  market_value: number,
  profit: number,
  profit_percent: number,
  notes?: string
}) {
  return withDatabase((db) => {
    const stmt = db.prepare(`
      INSERT INTO user_positions (
        user_id, stock_id, symbol, stock_name, quantity, avg_cost, market_value, profit, profit_percent, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      position.user_id,
      position.stock_id,
      position.symbol,
      position.stock_name,
      position.quantity,
      position.avg_cost,
      position.market_value,
      position.profit,
      position.profit_percent,
      position.notes || ''
    )
    return db.prepare('SELECT * FROM user_positions WHERE user_id = ? ORDER BY id').all(position.user_id)
  })
}

async function updateUserPosition(positionId: number, updates: Partial<{
  quantity: number,
  avg_cost: number,
  market_value: number,
  profit: number,
  profit_percent: number,
  notes?: string
}>) {
  return withDatabase((db) => {
    // 构建动态更新语句
    const updateFields = Object.keys(updates).map(key => `${key} = ?`).join(', ')
    const updateValues = Object.values(updates)
    
    if (updateFields) {
      const stmt = db.prepare(`
        UPDATE user_positions SET ${updateFields} WHERE id = ?
      `)
      stmt.run(...updateValues, positionId)
    }
    
    return db.prepare('SELECT * FROM user_positions WHERE id = ?').get(positionId)
  })
}

async function deleteUserPosition(positionId: number) {
  return withDatabase((db) => {
    const stmt = db.prepare('DELETE FROM user_positions WHERE id = ?')
    stmt.run(positionId)
    return { success: true, positionId }
  })
}

// 用户相关函数（注释掉未使用的函数）
/*
async function createUser(user: { username: string, email: string }) {
  return withDatabase((db) => {
    const stmt = db.prepare('INSERT INTO users (username, email) VALUES (?, ?)')
    const result = stmt.run(user.username, user.email)
    return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)
  })
}
*/

// 检查并创建默认用户
async function ensureDefaultUser() {
  return withDatabase((db) => {
    const count = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count
    if (count === 0) {
      const stmt = db.prepare('INSERT INTO users (username, email) VALUES (?, ?)')
      stmt.run('demo_user', 'demo@example.com')
      return { id: 1, username: 'demo_user', email: 'demo@example.com' }
    }
    return db.prepare('SELECT * FROM users LIMIT 1').get()
  })
}

// 导出服务器函数
const getPositions = createServerFn({
  method: 'GET',
}).handler(async () => {
  // 确保有默认用户
  const defaultUser = await ensureDefaultUser()
  // 获取默认用户的持仓
  return await getUserPositions(defaultUser.id)
})

const addPosition = createServerFn({ method: 'POST' })
  .inputValidator((d: any) => d)
  .handler(async ({ data }) => {
    // 确保有默认用户
    const defaultUser = await ensureDefaultUser()
    // 添加持仓
    return await addUserPosition({
      ...data,
      user_id: defaultUser.id
    })
  })

const updatePosition = createServerFn({ method: 'POST' })
  .inputValidator((d: any) => d)
  .handler(async ({ data }) => {
    // 更新持仓
    return await updateUserPosition(data.id, data.updates)
  })

const deletePosition = createServerFn({ method: 'POST' })
  .inputValidator((d: number) => d)
  .handler(async ({ data }) => {
    // 删除持仓
    await deleteUserPosition(data)
    // 返回更新后的持仓列表
    const defaultUser = await ensureDefaultUser()
    return await getUserPositions(defaultUser.id)
  })

/*
// 注意：createServerFn只支持GET和POST方法
const getPositions = createServerFn({
  method: 'GET',
}).handler(async ({ data }) => {
  const userId = data as number
  return await getUserPositions(userId)
})

const addPosition = createServerFn({ method: 'POST' })
  .inputValidator((d: any) => d)
  .handler(async ({ data }) => {
    return await addUserPosition(data)
  })

// 更新和删除功能需要通过POST方法实现
const updatePosition = createServerFn({ method: 'POST' })
  .inputValidator((d: any) => d)
  .handler(async ({ data }) => {
    return await updateUserPosition(data.id, data.updates)
  })

const deletePosition = createServerFn({ method: 'POST' })
  .inputValidator((d: number) => d)
  .handler(async ({ data }) => {
    return await deleteUserPosition(data)
  })

const createUser = createServerFn({ method: 'POST' })
  .inputValidator((d: any) => d)
  .handler(async ({ data }) => {
    return await createUser(data)
  })
*/

export const Route = createFileRoute('/demo/start/server-funcs')({
  component: Home,
  loader: async () => await getPositions(),
})

function Home() {
  const router = useRouter()
  let positions = Route.useLoaderData() as any[]

  const [editingId, setEditingId] = useState<number | null>(null)
    const [editValues, setEditValues] = useState<{ quantity?: number, avg_cost?: number, notes?: string }>({})
    const [showModal, setShowModal] = useState(false)
  
  // 新增持仓表单状态
  const [newPosition, setNewPosition] = useState({
    stock_id: '',
    symbol: '',
    stock_name: '',
    quantity: 0,
    avg_cost: 0,
    market_value: 0,
    profit: 0,
    profit_percent: 0,
    notes: ''
  })

  // 提交新增持仓
  const submitNewPosition = useCallback(async () => {
    if (!newPosition.symbol || !newPosition.stock_name) return
    
    await addPosition({ data: newPosition })
    setNewPosition({
      stock_id: '',
      symbol: '',
      stock_name: '',
      quantity: 0,
      avg_cost: 0,
      market_value: 0,
      profit: 0,
      profit_percent: 0,
      notes: ''
    })
    setShowModal(false)
    router.invalidate()
  }, [addPosition, newPosition, setShowModal])

  // 删除持仓
  const handleDelete = useCallback(async (id: number) => {
    await deletePosition({ data: id })
    router.invalidate()
  }, [deletePosition])

  // 开始编辑
  const startEditing = useCallback((position: any) => {
    setEditingId(position.id)
    setEditValues({
      quantity: position.quantity,
      avg_cost: position.avg_cost,
      notes: position.notes
    })
  }, [])

  // 保存编辑
  const saveEdit = useCallback(async (id: number) => {
    await updatePosition({ 
      data: { 
        id, 
        updates: editValues 
      } 
    })
    setEditingId(null)
    setEditValues({})
    router.invalidate()
  }, [updatePosition, editValues])

  // 取消编辑
  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditValues({})
  }, [])

  return (
    <div
      className="flex items-center justify-center min-h-screen bg-gradient-to-br from-zinc-800 to-black p-4 text-white"
      style={{
        backgroundImage:
          'radial-gradient(50% 50% at 20% 60%, #23272a 0%, #18181b 50%, #000000 100%)',
      }}
    >
      <div className="w-full max-w-4xl p-8 rounded-xl backdrop-blur-md bg-black/50 shadow-xl border-8 border-black/10">
        <h1 className="text-2xl mb-6">用户持仓管理</h1>
        
        {/* 持仓列表 */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl">持仓列表</h2>
            <button
              onClick={() => setShowModal(true)}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              添加持仓
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-white/5">
                  <th className="px-4 py-3 text-left border-b border-white/20">代码</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">名称</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">数量</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">成本</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">市值</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">盈亏</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">盈亏率</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">备注</th>
                  <th className="px-4 py-3 text-left border-b border-white/20">操作</th>
                </tr>
              </thead>
              <tbody>
                {positions?.map((pos: any) => (
                  <tr key={pos.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 border-b border-white/10">{pos.symbol}</td>
                    <td className="px-4 py-3 border-b border-white/10">{pos.stock_name}</td>
                    
                    {editingId === pos.id ? (
                      <>
                        <td className="px-4 py-3 border-b border-white/10">
                          <input
                            type="number"
                            value={editValues['quantity'] || 0}
                            onChange={(e) => setEditValues({...editValues, quantity: parseInt(e.target.value) || 0})}
                            className="w-24 px-2 py-1 rounded bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        </td>
                        <td className="px-4 py-3 border-b border-white/10">
                          <input
                            type="number"
                            value={editValues['avg_cost'] || 0}
                            onChange={(e) => setEditValues({...editValues, avg_cost: parseFloat(e.target.value) || 0})}
                            className="w-24 px-2 py-1 rounded bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 border-b border-white/10">{pos.quantity}</td>
                        <td className="px-4 py-3 border-b border-white/10">{pos.avg_cost.toFixed(2)}</td>
                      </>
                    )}
                    
                    <td className="px-4 py-3 border-b border-white/10">{pos.market_value.toFixed(2)}</td>
                    <td className={`px-4 py-3 border-b border-white/10 ${pos.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pos.profit >= 0 ? '+' : ''}{pos.profit.toFixed(2)}
                    </td>
                    <td className={`px-4 py-3 border-b border-white/10 ${pos.profit_percent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pos.profit_percent >= 0 ? '+' : ''}{pos.profit_percent.toFixed(2)}%
                    </td>
                    
                    {editingId === pos.id ? (
                      <td className="px-4 py-3 border-b border-white/10">
                        <textarea
                          value={editValues['notes'] || ''}
                          onChange={(e) => setEditValues({...editValues, notes: e.target.value})}
                          rows={2}
                          className="w-full px-2 py-1 rounded bg-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      </td>
                    ) : (
                      <td className="px-4 py-3 border-b border-white/10">{pos.notes || '-'}</td>
                    )}
                    <td className="px-4 py-3 border-b border-white/10">
                      {editingId === pos.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(pos.id)}
                            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded mr-2 transition-colors"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditing(pos)}
                            className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded mr-2 transition-colors"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(pos.id)}
                            className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded transition-colors"
                          >
                            删除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* 新增持仓模态框 */}
        {showModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-zinc-900 rounded-xl shadow-2xl border border-white/20 w-full max-w-2xl">
              <div className="flex justify-between items-center p-6 border-b border-white/20">
                <h2 className="text-xl font-bold">新增持仓</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-white/80 hover:text-white text-2xl leading-none"
                >
                  ×
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="股票代码"
                    value={newPosition.symbol}
                    onChange={(e) => setNewPosition({...newPosition, symbol: e.target.value})}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <input
                    type="text"
                    placeholder="股票名称"
                    value={newPosition.stock_name}
                    onChange={(e) => setNewPosition({...newPosition, stock_name: e.target.value})}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <input
                    type="number"
                    placeholder="持仓数量"
                    value={newPosition.quantity}
                    onChange={(e) => setNewPosition({...newPosition, quantity: parseInt(e.target.value) || 0})}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <input
                    type="number"
                    placeholder="平均成本"
                    value={newPosition.avg_cost}
                    onChange={(e) => setNewPosition({...newPosition, avg_cost: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <input
                    type="number"
                    placeholder="市值"
                    value={newPosition.market_value}
                    onChange={(e) => setNewPosition({...newPosition, market_value: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <input
                    type="number"
                    placeholder="盈亏金额"
                    value={newPosition.profit}
                    onChange={(e) => setNewPosition({...newPosition, profit: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                  <textarea
                    placeholder="备注信息"
                    value={newPosition.notes}
                    onChange={(e) => setNewPosition({...newPosition, notes: e.target.value})}
                    rows={3}
                    className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={submitNewPosition}
                    disabled={!newPosition.symbol || !newPosition.stock_name}
                    className="bg-green-500 hover:bg-green-600 disabled:bg-green-500/50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
                  >
                    添加持仓
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
