document.addEventListener("DOMContentLoaded", () => {

  const textarea   = document.getElementById("prompt");
  const chat       = document.querySelector(".chat");

  /**
   * Automatically scrolls the viewport and the chat container to the bottom.
   * Ensures the user always sees the latest messages and the input area remains in focus.
   */
  function scrollToBottom() {
    chat.scrollTop = chat.scrollHeight;
    const inputArea = document.getElementById("input_area");
    if (inputArea) {
      inputArea.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }

  // Adjust textarea height dynamically based on user input to prevent clipping
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  });

  // Handle message submission when the user presses Enter (without Shift)
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;

      addMessage(text, "user");
      
      textarea.value = "";
      textarea.style.height = "auto";

      sendToFlask(text);
    }
  });

  /**
   * Reconstructs the conversation history dynamically by reading the DOM structure.
   * This allows the system to send accurate context to the server, especially when 
   * the user navigates back to older versions of a bot's response.
   * 
   * @param {HTMLElement} upToElement - If provided, scanning stops right before this element.
   * @param {string} partialText - Text to append at the end of the history (used during regeneration).
   * @returns {Array} An array of message objects containing role and content.
   */
  function buildMessagesHistory(upToElement = null, partialText = "") {
      const history = [];
      const chatNodes = chat.querySelectorAll('.message');
      
      for (let node of chatNodes) {
          if (node === upToElement) break;
          
          if (node.classList.contains('user')) {
              history.push({ role: 'user', content: node.innerText });
          } else if (node.classList.contains('bot-group')) {
              // Extract text from the currently selected version of the bot's response
              if (node._versions && node._versions.length > 0) {
                  const version = node._versions[node._currentIndex];
                  if (version && version.text) {
                      history.push({ role: 'assistant', content: version.text });
                  }
              }
          }
      }
      
      if (partialText) {
          history.push({ role: 'assistant', content: partialText });
      }
      return history;
  }

  /**
   * Updates the UI to display a specific version of a bot's response.
   * Handles the visibility of control arrows and parameter metadata.
   * 
   * @param {HTMLElement} msgGroup - The container element for the bot's response cluster.
   */
  function renderVersion(msgGroup) {
      const content = msgGroup.querySelector(".message-content");
      const controls = msgGroup.querySelector(".version-controls");
      const counter = controls.querySelector(".version-counter");
      const paramsDiv = msgGroup.querySelector(".version-params");

      const version = msgGroup._versions[msgGroup._currentIndex];
      content.innerHTML = version.html;

      // Populate and display the generation parameters if they were stored with this version
      if (version.params) {
          paramsDiv.style.display = "flex";
          paramsDiv.innerHTML = `
              <div class="param-item"><span class="param-label">Temp:</span> <span class="param-value">${version.params.temperature}</span></div>
              <div class="param-item"><span class="param-label">Tokens:</span> <span class="param-value">${version.params.max_tokens}</span></div>
              <div class="param-item"><span class="param-label">Trait:</span> <span class="param-value">${version.params.personality}</span></div>
              <div class="param-item"><span class="param-label">Mult:</span> <span class="param-value">${version.params.multiplier}</span></div>
          `;
      } else {
          paramsDiv.style.display = "none";
      }

      // Reattach event listeners to tokenized response words after DOM replacement
      content.querySelectorAll(".token_response").forEach(token => {
          token.addEventListener("click", () => {
              autoPopup(token);
          });
      });

      counter.textContent = `${msgGroup._currentIndex + 1} / ${msgGroup._versions.length}`;

      // Only show navigation arrows if there is more than one version available
      if (msgGroup._versions.length > 1) {
          controls.style.display = "flex";
      } else {
          controls.style.display = "none";
      }
  }

  /**
   * Requests a partial regeneration of a response from the backend after a user modifies a token.
   * Creates a new branch (version) of the response based on the altered text.
   * 
   * @param {string} partialText - The text up to the modified token to base generation on.
   * @param {HTMLElement} tokenDiv - The specific token element that was interacted with.
   * @param {number} modifiedIndex - The index position of the modified token to highlight it later.
   */
  async function regenResponse(partialText, tokenDiv, modifiedIndex = -1) {
      const temperature = parseFloat(document.querySelector(".temperature").value);
      const max_tokens  = parseInt(document.getElementById("token-slider").value);

      // IMPORTANT!
      // The username in the following url (e.g.,user@campus.unimib.it) must be replaced with the one of the user
      // that is running the server at ice4hpc.disco.unimib.it
      const url = "/user/user@campus.unimib.it/proxy/8080/"; 

      const botGroup = tokenDiv.closest('.bot-group');
      const contentDiv = botGroup.querySelector('.message-content');

      const currentMessages = buildMessagesHistory(botGroup, partialText.trim());

      contentDiv.innerHTML = "partial regeneration...";
      scrollToBottom();

      try {
          const selectedPersonality = document.getElementById("personality").value;
          const currentMultiplier = parseFloat(document.querySelector(".multiplier").value || 1.0);

          const currentParams = {
              temperature: parseFloat(temperature),
              max_tokens:  parseInt(max_tokens),
              personality: selectedPersonality,
              multiplier:  currentMultiplier
          };

          const payload = {
              messages: currentMessages,
              temperature: currentParams.temperature,
              max_tokens:  currentParams.max_tokens,
              personality: currentParams.personality, 
              multiplier:  currentParams.multiplier                  
          };

          const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
          });

          const data = await res.json();

          if (data.error) {
              contentDiv.innerHTML = "Error: " + data.error;
              
              // Visually rollback to the previous version after displaying the error
              setTimeout(() => renderVersion(botGroup), 2000);
              scrollToBottom();
              return;
          }

          contentDiv.innerHTML = data.response;
          
          // Apply a highlight class to the token that triggered the regeneration
          const newTokens = contentDiv.querySelectorAll(".token_response");
          if (modifiedIndex >= 0 && modifiedIndex < newTokens.length) {
              newTokens[modifiedIndex].classList.add("highlighted_token");
          }

          // Save this new output as a distinct version in the element's state
          const finalHtml = contentDiv.innerHTML;
          const finalText = contentDiv.innerText;

          botGroup._versions.push({ html: finalHtml, text: finalText, params: currentParams });
          botGroup._currentIndex = botGroup._versions.length - 1;

          renderVersion(botGroup);
          scrollToBottom();

      } catch (err) {
          contentDiv.innerHTML = "Network error during regeneration.";
          console.error(err);
          setTimeout(() => renderVersion(botGroup), 2000);
          scrollToBottom();
      }
  }

  /**
   * Opens a popup window to allow the user to modify a specific token in the response.
   * 
   * @param {HTMLElement} tokenDiv - The token element clicked by the user.
   */
  function autoPopup(tokenDiv) {
      tokenDiv.classList.add("editing_token");

      var style = "top=10, left=10, width=400, height=250, status=no, menubar=no, toolbar=no, scrollbars=no";
      var text = window.open("", "", style);
      
      text.document.write('<html>\n');
      text.document.write('<head>\n');
      text.document.write('<link rel="stylesheet" href="style.css">\n');
      text.document.write('</head>\n');
      text.document.write('<body topmargin=50>\n');
      text.document.write('<h3>Word to replace with:</h3>\n');
      text.document.write('<div align=center><input type="text" id="newToken"></div>\n');
      text.document.write('<button id="confirmBtn">Confirm</button>\n');
      text.document.write('</body></html>');
      text.document.close();

      // Logic executed when the user confirms the token edit
      function onClosure() {
          tokenDiv.classList.remove("editing_token");

          var newText = text.document.getElementById("newToken").value;
          tokenDiv.textContent = newText;
          text.close();
          
          var botGroup = tokenDiv.closest(".bot-group");
          var contentDiv = botGroup.querySelector(".message-content");
          var textToSend = "";
          
          var tokenList = contentDiv.querySelectorAll(".token_response");
          var modifiedIndex = -1;
          var count = 0;

          // Rebuild the prompt string up to the point of the modified token, discarding the rest
          for (let t of tokenList) {
              textToSend += t.textContent + " ";
              if (t === tokenDiv) {
                  modifiedIndex = count;
                  break; 
              }
              count++;
          }
          regenResponse(textToSend.trim(), tokenDiv, modifiedIndex);
      }
      text.document.getElementById("confirmBtn").addEventListener("click", onClosure);
      
      // Ensure the visual highlight is removed if the user dismisses the popup without confirming
      text.addEventListener("beforeunload", () => {
          tokenDiv.classList.remove("editing_token");
      });
  }

  /**
   * Handles the primary flow of sending a user prompt to the backend LLM service.
   * 
   * @param {string} userText - The message typed by the user.
   */
  async function sendToFlask(userText) {
      const temperature = parseFloat(document.querySelector(".temperature").value);
      const max_tokens  = parseInt(document.getElementById("token-slider").value);
      const prefix      = document.getElementById("prefix").value.trim();
      const currentMultiplier = parseFloat(document.querySelector(".multiplier").value || 1.0);
      const selectedPersonality = document.getElementById("personality").value;

      const currentParams = {
          temperature: temperature,
          max_tokens: max_tokens,
          personality: selectedPersonality,
          multiplier: currentMultiplier
      };

      const currentMessages = buildMessagesHistory();
      currentMessages.push({ role: "user", content: userText });
      
      // Inject prefix if provided
      if (prefix !== "") {
          currentMessages.push({ role: "assistant", content: prefix });
      }

      const botGroup = addMessage("generating response...", "bot");
      const contentDiv = botGroup.querySelector('.message-content');

      try {
        // IMPORTANT!
        // The username in the following url (e.g., user@campus.unimib.it) must be replaced with the one of the user
        // that is running the server at ice4hpc.disco.unimib.it
        const url = "/user/user@campus.unimib.it/proxy/8080/";
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: currentMessages,
            temperature: currentParams.temperature,
            max_tokens: currentParams.max_tokens,
            personality: currentParams.personality,
            multiplier: currentParams.multiplier
          })
        });

        const data = await res.json();

        if (data.error) {
            contentDiv.innerHTML = "model error: " + data.error;
            scrollToBottom();
            return;
        }
        
        let reply = data.response;
        contentDiv.innerHTML = reply;
        
        // Initialize the tracking arrays for this specific message block
        botGroup._versions = [{ html: contentDiv.innerHTML, text: contentDiv.innerText, params: currentParams }];
        botGroup._currentIndex = 0;
        
        renderVersion(botGroup);
        scrollToBottom();

      } catch (err) {
        contentDiv.textContent = "Network error: cannot reach the cluster";
        console.error(err);
        scrollToBottom();
      }
  }

  // Handles the file upload interaction for the behavior vector input.
  function handleUpload() {
    showMultiplexer();
    document.getElementById('file-upload').click();
  }

  // Displays the multiplexer control when the user interacts with the behavior vector input.
  function showMultiplexer() {
    const multiplexer = document.getElementById("multiplexer");
    if (multiplexer) multiplexer.style.display = "block"; 
  }

  /**
   * Appends a new message box to the chat interface.
   * If the sender is the 'bot', it also generates the complex nested DOM structure
   * needed to support versioning, parameter display, and navigational arrows.
   * 
   * @param {string} text - The initial text to display.
   * @param {string} type - "user" or "bot", dictates styling and layout.
   * @returns {HTMLElement} The newly created outer message wrapper.
   */
  function addMessage(text, type) {
      const msg = document.createElement("div");
      msg.classList.add("message", type);
      
      if(type === "bot") {
          msg.classList.add("bot-group");
          msg.style.borderColor = "#444";
          msg.style.color = "#e8e8e0";

          // Container for displaying generation parameters (e.g., Temp, Traits)
          const paramsDiv = document.createElement("div");
          paramsDiv.classList.add("version-params");
          paramsDiv.style.display = "none";
          msg.appendChild(paramsDiv);

          // Container for the actual text content or interactive tokens
          const content = document.createElement("div");
          content.classList.add("message-content");
          content.textContent = text;
          msg.appendChild(content);

          // Container for the arrow controls used to cycle through modified versions
          const controls = document.createElement("div");
          controls.classList.add("version-controls");
          controls.style.display = "none";
          controls.innerHTML = `
              <button class="nav-arrow left-arrow">◄</button>
              <span class="version-counter">1 / 1</span>
              <button class="nav-arrow right-arrow">►</button>
          `;
          msg.appendChild(controls);

          // State initialization attached directly to the DOM node
          msg._versions = [];
          msg._currentIndex = -1;

          // Event listeners for navigating between saved response states
          const leftBtn = controls.querySelector(".left-arrow");
          const rightBtn = controls.querySelector(".right-arrow");

          leftBtn.addEventListener("click", (e) => {
              e.preventDefault();
              if (msg._currentIndex > 0) {
                  msg._currentIndex--;
                  renderVersion(msg);
              }
          });

          rightBtn.addEventListener("click", (e) => {
              e.preventDefault();
              if (msg._currentIndex < msg._versions.length - 1) {
                  msg._currentIndex++;
                  renderVersion(msg);
              }
          });

      } else {
          msg.textContent = text;
      }

      chat.appendChild(msg);
      scrollToBottom();
      
      return msg; 
  }

});