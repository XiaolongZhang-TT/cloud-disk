/* Visual + interaction smoke test for 云屿 CloudDisk.
   Usage: node scripts/screenshot.mjs [baseUrl]
   Requires playwright-core and a local Google Chrome. */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:18080'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = path.resolve('screenshots')
fs.mkdirSync(OUT, { recursive: true })

const shots = []
const problems = []
const checks = []

async function shot(page, name) {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file })
  shots.push(file)
  console.log('screenshot', name)
}

async function clearToasts(page) {
  for (let i = 0; i < 4; i += 1) {
    const count = await page.locator('.toast-close').count()
    if (count === 0) break
    await page.locator('.toast-close').first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(150)
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户名').fill('admin')
  await page.getByLabel('密码', { exact: true }).fill('clouddisk123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await clearToasts(page)
}

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // an intentional invalid-token share probe returns 404 — not an app error
    if (text.includes('status of 404')) return
    problems.push(`[${label}] console: ${text}`)
  })
  page.on('pageerror', (error) => problems.push(`[${label}] pageerror: ${error.message}`))
}

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
}

const share1 = JSON.parse(fs.readFileSync('/tmp/share1.json', 'utf8')).share
const share2 = JSON.parse(fs.readFileSync('/tmp/share2.json', 'utf8')).share

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

try {
  /* ------------------------------- desktop ----------------------------- */
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
  })
  const page = await desktop.newPage()
  watch(page, 'desktop')

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await shot(page, '01-login-1440x900.png')

  await login(page)
  await shot(page, '02-drive-1440x900.png')

  await page.locator('.file-card', { hasText: '产品设计' }).first().click()
  await page.waitForTimeout(1100)
  await shot(page, '03-folder-1440x900.png')

  await page.locator('.view-toggle button').nth(1).click()
  await page.waitForTimeout(500)
  await shot(page, '04-list-view-1440x900.png')
  await page.locator('.view-toggle button').nth(0).click()
  await page.waitForTimeout(300)

  await page.locator('.file-card', { hasText: 'brand-exploration.svg' }).first().click()
  await page.waitForSelector('.preview-overlay')
  await page.waitForTimeout(650)
  await shot(page, '05-preview-1440x900.png')
  const previewTitle = await page.locator('.preview-title-text h2').textContent()
  check('preview opens selected file', Boolean(previewTitle?.includes('brand-exploration')))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  await page.locator('.file-card', { hasText: 'design-notes.md' }).first().click()
  await page.waitForSelector('.preview-text', { timeout: 10000 })
  await page.waitForTimeout(300)
  const textPreview = await page.locator('.preview-text').textContent()
  check('text preview renders content', Boolean(textPreview?.includes('设计说明')))
  await shot(page, '05b-text-preview-1440x900.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const card = page.locator('.file-card', { hasText: 'brand-exploration.svg' }).first()
  await card.hover()
  await card.locator('.card-more').click({ force: true })
  await page.waitForSelector('.context-menu')
  await page.waitForTimeout(250)
  await shot(page, '06-context-menu-1440x900.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  await card.hover()
  await card.locator('.card-more').click({ force: true })
  await page.getByRole('menuitem', { name: '分享' }).click()
  await page.waitForSelector('.modal-panel')
  await page.waitForTimeout(350)
  await shot(page, '07-share-dialog-1440x900.png')
  await page.getByRole('button', { name: '创建分享链接' }).click()
  await page.waitForSelector('.share-result', { timeout: 10000 })
  await page.waitForTimeout(350)
  await shot(page, '07b-share-created-1440x900.png')
  const createdLink = await page.locator('.share-link-box input').inputValue()
  check('share link is absolute', createdLink.startsWith('http'))
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(250)

  // remove the share created by this smoke test
  const sharesResponse = await desktop.request.get(`${BASE}/api/shares`)
  const sharesData = await sharesResponse.json()
  for (const item of sharesData.items || []) {
    if (item.node?.name === 'brand-exploration.svg' && item.token !== share1.token) {
      await desktop.request.delete(`${BASE}/api/shares/${item.id}`)
    }
  }

  await page.getByRole('link', { name: '分享', exact: true }).click()
  await page.waitForTimeout(700)
  await shot(page, '08-shares-1440x900.png')
  check('shares page lists existing shares', (await page.locator('.share-row').count()) >= 2)

  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByRole('menuitem', { name: '设置' }).click()
  await page.waitForTimeout(800)
  await shot(page, '09-settings-1440x900.png')

  await page.locator('.admin-panel').scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await shot(page, '10-admin-members-1440x900.png')
  check('admin member rows render', (await page.locator('.member-row').count()) >= 1)
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.waitForTimeout(400)
  await shot(page, '11-add-member-dialog-1440x900.png')
  const memberDialog = page.locator('.modal-panel')
  await memberDialog.getByLabel('用户名').fill('uitest_member')
  await memberDialog.getByLabel('显示名称').fill('UI 测试成员')
  await memberDialog.getByLabel('登录密码').fill('testpass123')
  await memberDialog.getByRole('button', { name: '添加成员', exact: true }).click()
  await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 10000 })
  await page.waitForTimeout(1200)
  check('add member creates a row', await page.getByText('@uitest_member').isVisible())
  await clearToasts(page)
  const usersResponse = await desktop.request.get(`${BASE}/api/admin/users`)
  const usersData = await usersResponse.json()
  for (const item of usersData.items || []) {
    if (item.username === 'uitest_member') {
      await desktop.request.delete(`${BASE}/api/admin/users/${item.id}`)
    }
  }

  await page.locator('.theme-toggle').click()
  await page.getByRole('link', { name: '全部文件', exact: true }).click()
  await page.waitForTimeout(900)
  await clearToasts(page)
  await shot(page, '12-drive-dark-1440x900.png')

  await page.getByRole('link', { name: '回收站', exact: true }).click()
  await page.waitForTimeout(700)
  await shot(page, '13-trash-dark-1440x900.png')
  check('trash page lists trashed item', (await page.locator('.trash-row').count()) >= 1)

  /* -------------------------------- smoke ------------------------------ */
  await page.locator('.theme-toggle').click()
  await page.getByRole('link', { name: '全部文件', exact: true }).click()
  await page.waitForTimeout(500)

  await page.locator('.global-search input').fill('brand')
  await page.locator('.global-search input').press('Enter')
  await page.waitForURL(/\/search\?q=/, { timeout: 10000 })
  await page.waitForTimeout(700)
  check('search returns results', (await page.locator('.file-card').count()) >= 1)
  await shot(page, '14-search-1440x900.png')

  await page.getByRole('link', { name: '全部文件', exact: true }).click()
  await page.waitForTimeout(600)

  await page.getByRole('button', { name: '新建文件夹' }).click()
  await page.getByLabel('文件夹名称').fill('临时测试文件夹')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.waitForTimeout(1200)
  check(
    'create folder appears in list',
    (await page.locator('.file-card', { hasText: '临时测试文件夹' }).count()) === 1,
  )
  await clearToasts(page)

  const tempCard = page.locator('.file-card', { hasText: '临时测试文件夹' }).first()
  await tempCard.hover()
  await tempCard.locator('.card-more').click({ force: true })
  await page.getByRole('menuitem', { name: '重命名' }).click()
  await page.locator('.modal-panel .input').fill('临时测试文件夹B')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(1200)
  check(
    'rename updates file list',
    (await page.locator('.file-card', { hasText: '临时测试文件夹B' }).count()) === 1,
  )
  await clearToasts(page)

  const renamed = page.locator('.file-card', { hasText: '临时测试文件夹B' }).first()
  await renamed.hover()
  await renamed.locator('.card-more').click({ force: true })
  await page.getByRole('menuitem', { name: '移动到…' }).click()
  await page.waitForSelector('.move-picker')
  await page.waitForTimeout(800)
  check('move folder picker lists destinations', (await page.locator('.move-folder').count()) >= 1)
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(300)

  // bulk selection bar
  await page.locator('.file-card', { hasText: '产品设计' }).first().locator('.select-box').click()
  await page.locator('.file-card', { hasText: '旅行相册' }).first().locator('.select-box').click()
  await page.waitForTimeout(300)
  check('bulk action bar appears', await page.locator('.bulkbar').isVisible())
  await shot(page, '14b-bulk-selection-1440x900.png')
  await page.locator('.bulk-clear').click()
  await page.waitForTimeout(250)

  // create folder via dialog, then delete it with the keyboard + confirm
  await page.getByRole('button', { name: '新建文件夹' }).click()
  await page.getByLabel('文件夹名称').fill('删除测试')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.waitForTimeout(1200)
  await clearToasts(page)
  await page.locator('.file-card', { hasText: '删除测试' }).first().locator('.select-box').click()
  await page.keyboard.press('Delete')
  await page.waitForSelector('.modal-panel')
  check(
    'Delete shortcut opens confirm',
    (await page.locator('.modal-title').innerText()).includes('删除'),
  )
  await page.getByRole('button', { name: '移到回收站', exact: true }).click()
  await page.waitForTimeout(1200)
  check(
    'Delete shortcut moves item to trash',
    (await page.locator('.file-card', { hasText: '删除测试' }).count()) === 0,
  )
  await clearToasts(page)
  const trashAfterDelete = await (await desktop.request.get(`${BASE}/api/trash`)).json()
  for (const item of trashAfterDelete.items || []) {
    if (item.name === '删除测试') await desktop.request.delete(`${BASE}/api/trash/${item.id}`)
  }

  // move a folder through the move dialog
  await page.getByRole('button', { name: '新建文件夹' }).click()
  await page.getByLabel('文件夹名称').fill('移动测试')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.waitForTimeout(1200)
  await clearToasts(page)
  const moveCard = page.locator('.file-card', { hasText: '移动测试' }).first()
  await moveCard.hover()
  await moveCard.locator('.card-more').click({ force: true })
  await page.getByRole('menuitem', { name: '移动到…' }).click()
  await page.waitForSelector('.move-picker')
  await page.waitForTimeout(700)
  await page.locator('.move-folder', { hasText: '产品设计' }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '移动到此处' }).click()
  await page.waitForTimeout(1400)
  check(
    'move dialog removes card from current folder',
    (await page.locator('.file-card', { hasText: '移动测试' }).count()) === 0,
  )
  await clearToasts(page)
  const rootNodes = await (await desktop.request.get(`${BASE}/api/nodes`)).json()
  const designFolder = (rootNodes.items || []).find((item) => item.name === '产品设计')
  if (designFolder) {
    const childNodes = await (
      await desktop.request.get(`${BASE}/api/nodes?parentId=${designFolder.id}`)
    ).json()
    const moved = (childNodes.items || []).find((item) => item.name === '移动测试')
    check('move dialog changed parent folder', Boolean(moved))
    if (moved) {
      await desktop.request.delete(`${BASE}/api/nodes/${moved.id}`)
      await desktop.request.delete(`${BASE}/api/trash/${moved.id}`)
    }
  }

  // restore an item from the trash
  await page.getByRole('link', { name: '回收站', exact: true }).click()
  await page.waitForTimeout(900)
  const restoreRow = page.locator('.trash-row', { hasText: 'old-notes.txt' }).first()
  check('trash contains restorable item', (await restoreRow.count()) === 1)
  await restoreRow.getByRole('button', { name: '恢复' }).click()
  await page.waitForTimeout(1400)
  check(
    'restore removes item from trash',
    (await page.locator('.trash-row', { hasText: 'old-notes.txt' }).count()) === 0,
  )
  await clearToasts(page)
  const projectNodes = await (await desktop.request.get(`${BASE}/api/nodes`)).json()
  const projectFolder = (projectNodes.items || []).find((item) => item.name === '项目资料')
  if (projectFolder) {
    const projectChildren = await (
      await desktop.request.get(`${BASE}/api/nodes?parentId=${projectFolder.id}`)
    ).json()
    const restored = (projectChildren.items || []).find((item) => item.name === 'old-notes.txt')
    if (restored) await desktop.request.delete(`${BASE}/api/nodes/${restored.id}`)
  }
  await page.getByRole('link', { name: '全部文件', exact: true }).click()
  await page.waitForTimeout(700)

  fs.writeFileSync('/tmp/cd-seed/smoke-upload.txt', 'uploaded through the web UI\n'.repeat(600))
  await page.locator('input[type=file]').setInputFiles('/tmp/cd-seed/smoke-upload.txt')
  await page.waitForTimeout(2200)
  check(
    'upload through UI appears in list',
    (await page.locator('.file-card', { hasText: 'smoke-upload.txt' }).count()) === 1,
  )
  await shot(page, '14c-upload-panel-1440x900.png')

  const cleanup = async (name) => {
    const response = await desktop.request.get(`${BASE}/api/nodes`)
    const data = await response.json()
    for (const item of data.items || []) {
      if (item.name === name) {
        await desktop.request.delete(`${BASE}/api/nodes/${item.id}`)
        await desktop.request.delete(`${BASE}/api/trash/${item.id}`)
      }
    }
  }
  await cleanup('临时测试文件夹B')
  await cleanup('临时测试文件夹')
  await cleanup('smoke-upload.txt')
  await desktop.close()

  /* ----------------------------- public share -------------------------- */
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
  })
  const publicPage = await publicContext.newPage()
  watch(publicPage, 'public')
  await publicPage.goto(`${BASE}${share1.url}`, { waitUntil: 'networkidle' })
  await publicPage.waitForTimeout(800)
  await shot(publicPage, '15-public-share-1440x900.png')
  check('public share header renders', await publicPage.getByText('安全分享').isVisible())

  await publicPage.goto(`${BASE}${share2.url}`, { waitUntil: 'networkidle' })
  await publicPage.waitForTimeout(600)
  await shot(publicPage, '16-public-gate-1440x900.png')
  check('password gate is shown', await publicPage.getByText('此分享受密码保护').isVisible())
  await publicPage.getByLabel('访问密码').fill('yunyu2026')
  await publicPage.getByRole('button', { name: '访问文件' }).click()
  await publicPage.waitForTimeout(1000)
  await shot(publicPage, '17-public-unlocked-1440x900.png')
  check(
    'password unlock reveals download',
    await publicPage.getByRole('link', { name: /下载文件/ }).isVisible(),
  )

  await publicPage.goto(`${BASE}/s/invalid-token-for-test`, { waitUntil: 'networkidle' })
  await publicPage.waitForTimeout(500)
  check(
    'invalid share shows friendly state',
    await publicPage.getByText('分享不存在或已过期').isVisible(),
  )
  await publicContext.close()

  /* -------------------------------- mobile ----------------------------- */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  })
  const mpage = await mobile.newPage()
  watch(mpage, 'mobile')
  await mpage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mpage.waitForTimeout(400)
  await shot(mpage, '18-login-mobile-390x844.png')
  await login(mpage)
  await shot(mpage, '19-drive-mobile-390x844.png')

  await mpage.getByRole('button', { name: '打开菜单' }).click()
  await mpage.waitForTimeout(600)
  await shot(mpage, '20-drawer-mobile-390x844.png')
  await mpage.keyboard.press('Escape')
  await mpage.waitForTimeout(400)

  await mpage.locator('.file-card', { hasText: '产品设计' }).first().click()
  await mpage.waitForTimeout(1000)
  await mpage.locator('.file-card', { hasText: 'brand-exploration.svg' }).first().click()
  await mpage.waitForSelector('.preview-overlay')
  await mpage.waitForTimeout(700)
  await shot(mpage, '21-preview-mobile-390x844.png')
  await mobile.close()
} catch (error) {
  problems.push(`script: ${error.stack || error.message}`)
  console.error(error)
} finally {
  await browser.close()
}

const failedChecks = checks.filter((item) => !item.ok)
console.log('\n=== checks ===')
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`)
console.log(`\n${checks.length - failedChecks.length}/${checks.length} checks passed`)
console.log('\n=== screenshots ===')
for (const file of shots) console.log(file)
console.log('\n=== problems ===')
if (problems.length === 0) console.log('none')
else for (const problem of problems) console.log(problem)
process.exitCode = problems.length > 0 || failedChecks.length > 0 ? 1 : 0
