/**
 * Get the brand that corresponds with the hostname.
 *
 * @param {function(string)} copilotHostname - called with the copilot hostname
 * @param {function(string)} tabHostname - called with the URL of the current tab
 *
 */
let brandsPromise;

function getBrandFromHostname(copilotHostname, tabHostname) {
  if (!brandsPromise) {
    brandsPromise = fetchCopilotData(copilotHostname, 'api/configs');
  }

  return new Promise(function (resolve, reject) {
    brandsPromise.then(function (brands) {
      let brand = brands.find(function(config) {
        let hostnames = config.hostnames || {};
        return tabHostname.indexOf(hostnames.consumer) > -1 || tabHostname.indexOf(hostnames.preview) > -1;
      });
      if (brand) {
        resolve(brand);
      } else {
        reject();
      }
    }).catch(err => {
      brandsPromise = false;
      reject(err);
    });
  });
}

/**
 * Search the API for piece of content using digitalData, if found save the URL and enable the browserAction
 * @param  {Object} tab         tab where digitalData refers to
 */
function findCopilotContent(tab) {
  let brand;
  let url = new URL(tab.url);
  let tabHostname = url.hostname;
  let copilotHostname = 'copilot.aws.conde.io';
  let pathname = url.pathname;
  let identifier = pathname.replace(/^\/*(.*?)\/*$/, '$1'); 

  if(!tabHostname.endsWith('.com')) {
    copilotHostname = 'copilot.prod.cni.digital';
  } else {
    let subdomain = tabHostname.split(".")[0];

    switch(subdomain) {
      case 'stag':
        copilotHostname = 'stg-copilot.aws.conde.io';
        break;
      case 'ci':
        copilotHostname = 'ci-copilot.aws.conde.io';
        break;
      case 'ap-ci':
        copilotHostname = 'ci-copilot.aws.conde.io';
        break;
      default:
        copilotHostname = 'copilot.aws.conde.io';
    }
  }

  getBrandFromHostname(copilotHostname, tabHostname)
  .then(function (result) {
    brand = result;
    return authInstance(copilotHostname);
  })
  .then(function (authObj) {
    // Check if user has access to brand
    if (authObj && authObj.brands.indexOf(brand.code) > -1) {
      return setBrandCookie(copilotHostname, brand.code);
    }
    Promise.reject(new Error('User does not have access to brand'));
  })
  .then(searchCopilotByURI(copilotHostname, encodeURIComponent(identifier)))
  .then(function(data) {
    if (data.hits.total === 1) {
      let hit = data.hits.hits[0];
      let url = `https://${copilotHostname}/${brand.code}/${hit._source.meta.collectionName}/${hit._id}`;
      let storageData = {};
      storageData[`url${tab.id}`] = url;

      chrome.storage.sync.set(storageData, function() {
        chrome.browserAction.enable(tab.id);
        chrome.browserAction.setBadgeText({text: '', tabId: tab.id});
        chrome.browserAction.setTitle({title: 'Open in Copilot', tabId: tab.id});
      });
    }
  })
  .catch(function (err) {
    chrome.browserAction.setBadgeText({text: '!', tabId: tab.id});
    chrome.browserAction.setTitle({title: 'Error connecting, are you logged into Copilot?', tabId: tab.id});
  });
}

function fetchCopilotData(copilotHostname, path) {
  return new Promise(function (resolve, reject) {
    fetch(`https://${copilotHostname}/${path}`, {credentials: 'include', redirect: 'manual'})
    .then(status)
    .then(json)
    .then(resolve)
    .catch(reject);
  });
}

function status(response) {
  if (response.status >= 200 && response.status < 300 && response.redirected === false) {
    return Promise.resolve(response)
  } else {
    return Promise.reject(new Error(response.statusText))
  }
}

function json(response) {
  return response.json();
}

function setBrandCookie(copilotHostname, brandCode) {
  return new Promise(function (resolve, reject) {
    let brandCookie = {
      url: `https://${copilotHostname}/api/search`,
      name: 'brand',
      value: brandCode,
      expirationDate: (new Date().getTime()/1000) + 10
    };

    /* Set brand cookie to the current brand */
    chrome.cookies.set(brandCookie, function (cookie) {
      if (cookie) {
        resolve(cookie);
      } else {
        reject(new Error('Failed to set cookie'));
      }
    });
  });
}

function authInstance(copilotHostname) {
  return fetchCopilotData(copilotHostname, 'auth/instance');
}

function searchCopilotByURI(copilotHostname, uri) {
  return function () {
    return fetchCopilotData(copilotHostname, `api/search?view=edit&uri=${uri}`);
  }
}

/* Listen for the content-script to send digitalData if it exists */
chrome.runtime.onMessage.addListener(function (msg, sender) {
  findCopilotContent(sender.tab);
});

/* On Click - open the saved Copilot URL */
chrome.browserAction.onClicked.addListener(function(tab) {
  chrome.storage.sync.get(`url${tab.id}`, function(value) {
    chrome.tabs.create({url: value[`url${tab.id}`]});
  });
});

/* Disable the browserAction on start */
chrome.browserAction.disable();
