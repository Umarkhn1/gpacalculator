// Клик по значку расширения — импорт по требованию с открытой страницы LMS.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return
  if (!/^https:\/\/lms\.tuit\.uz\//.test(tab.url || '')) {
    chrome.tabs.create({ url: 'https://lms.tuit.uz/student/study-plan' })
    return
  }
  chrome.tabs.sendMessage(tab.id, 'import-now')
})
