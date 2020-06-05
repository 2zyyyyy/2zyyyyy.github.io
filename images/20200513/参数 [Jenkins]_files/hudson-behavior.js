/*
 * The MIT License
 * 
 * Copyright (c) 2004-2010, Sun Microsystems, Inc., Kohsuke Kawaguchi,
 * Daniel Dyer, Yahoo! Inc., Alan Harder, InfraDNA, Inc.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
//
//
// JavaScript for Jenkins
//     See http://www.ibm.com/developerworks/web/library/wa-memleak/?ca=dgr-lnxw97JavascriptLeaks
//     for memory leak patterns and how to prevent them.
//

if (window.isRunAsTest) {
    // Disable postMessage when running in test mode (HtmlUnit).
    window.postMessage = false;
}

// create a new object whose prototype is the given object
function object(o) {
    function F() {}
    F.prototype = o;
    return new F();
}

/**
 * A function that returns false if the page is known to be invisible.
 */
var isPageVisible = (function(){
    // @see https://developer.mozilla.org/en/DOM/Using_the_Page_Visibility_API
    // Set the name of the hidden property and the change event for visibility
    var hidden, visibilityChange;
    if (typeof document.hidden !== "undefined") {
        hidden = "hidden";
        visibilityChange = "visibilitychange";
    } else if (typeof document.mozHidden !== "undefined") {
        hidden = "mozHidden";
        visibilityChange = "mozvisibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
        hidden = "msHidden";
        visibilityChange = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
        hidden = "webkitHidden";
        visibilityChange = "webkitvisibilitychange";
    }

    // By default, visibility set to true
    var pageIsVisible = true;

    // If the page is hidden, prevent any polling
    // if the page is shown, restore pollings
    function onVisibilityChange() {
        pageIsVisible = !document[hidden];
    }

    // Warn if the browser doesn't support addEventListener or the Page Visibility API
    if (typeof document.addEventListener !== "undefined" && typeof hidden !== "undefined") {
        // Init the value to the real state of the page
        pageIsVisible = !document[hidden];

        // Handle page visibility change
        document.addEventListener(visibilityChange, onVisibilityChange, false);
    }

    return function() {
        return pageIsVisible;
    }
})();

// id generator
var iota = 0;

// crumb information
var crumb = {
    fieldName: null,
    value: null,

    init: function(crumbField, crumbValue) {
        if (crumbField=="") return; // layout.jelly passes in "" whereas it means null.
        this.fieldName = crumbField;
        this.value = crumbValue;
    },

    /**
     * Adds the crumb value into the given hash or array and returns it.
     */
    wrap: function(headers) {
        if (this.fieldName!=null) {
            if (headers instanceof Array)
                // TODO prototype.js only seems to interpret object
                headers.push(this.fieldName, this.value);
            else
                headers[this.fieldName]=this.value;
        }
        // TODO return value unused
        return headers;
    },

    /**
     * Puts a hidden input field to the form so that the form submission will have the crumb value
     */
    appendToForm : function(form) {
        if(this.fieldName==null)    return; // noop
        var div = document.createElement("div");
        div.innerHTML = "<input type="hidden" name=""+this.fieldName+"" value=""+this.value+"">";
        form.appendChild(div);
        if (form.enctype == "multipart/form-data") {
            if (form.action.indexOf("?") != -1) {
                form.action = form.action+"&"+this.fieldName+"="+this.value;
            } else {
                form.action = form.action+"?"+this.fieldName+"="+this.value;
            }
        }
    }
}

// Form check code
//========================================================
var FormChecker = {
    // pending requests
    queue : [],

    // conceptually boolean, but doing so create concurrency problem.
    // that is, during unit tests, the AJAX.send works synchronously, so
    // the onComplete happens before the send method returns. On a real environment,
    // more likely it's the other way around. So setting a boolean flag to true or false
    // won't work.
    inProgress : 0,

    /**
     * Schedules a form field check. Executions are serialized to reduce the bandwidth impact.
     *
     * @param url
     *      Remote doXYZ URL that performs the check. Query string should include the field value.
     * @param method
     *      HTTP method. GET or POST. I haven't confirmed specifics, but some browsers seem to cache GET requests.
     * @param target
     *      HTML element whose innerHTML will be overwritten when the check is completed.
     */
    delayedCheck : function(url, method, target) {
        if(url==null || method==null || target==null)
            return; // don't know whether we should throw an exception or ignore this. some broken plugins have illegal parameters
        this.queue.push({url:url, method:method, target:target});
        this.schedule();
    },

    sendRequest : function(url, params) {
        if (params.method == "post") {
            var idx = url.indexOf('?');
            params.parameters = url.substring(idx + 1);
            url = url.substring(0, idx);
        }
        new Ajax.Request(url, params);
    },

    schedule : function() {
        if (this.inProgress>0)  return;
        if (this.queue.length == 0) return;

        var next = this.queue.shift();
        this.sendRequest(next.url, {
            method : next.method,
            onComplete : function(x) {
                applyErrorMessage(next.target, x);
                FormChecker.inProgress--;
                FormChecker.schedule();
                layoutUpdateCallback.call();
            }
        });
        this.inProgress++;
    }
}

/**
 * Find the sibling (in the sense of the structured form submission) form item of the given name,
 * and returns that DOM node.
 *
 * @param {HTMLElement} e
 * @param {string} name
 *      Name of the control to find. Can include "../../" etc in the prefix.
 *      See @RelativePath.
 *
 *      We assume that the name is normalized and doesn't contain any redundant component.
 *      That is, ".." can only appear as prefix, and "foo/../bar" is not OK (because it can be reduced to "bar")
 */
function findNearBy(e,name) {
    while (name.startsWith("../")) {
        name = name.substring(3);
        e = findFormParent(e,null,true);
    }

    // name="foo/bar/zot"  -> prefixes=["bar","foo"] & name="zot"
    var prefixes = name.split("/");
    name = prefixes.pop();
    prefixes = prefixes.reverse();

    // does 'e' itself match the criteria?
    // as some plugins use the field name as a parameter value, instead of 'value'
    var p = findFormItem(e,name,function(e,filter) {
        return filter(e) ? e : null;
    });
    if (p!=null && prefixes.length==0)    return p;

    var owner = findFormParent(e,null,true);

    function locate(iterator,e) {// keep finding elements until we find the good match
        while (true) {
            e = iterator(e,name);
            if (e==null)    return null;

            // make sure this candidate element 'e' is in the right point in the hierarchy
            var p = e;
            for (var i=0; i<prefixes.length; i++) { p="findFormParent(p,null,true);" if (p.getattribute("name")!="prefixes[i])" return null; } (findformparent(p,null,true)="=owner)" e; locate(findpreviousformitem,e) || locate(findnextformitem,e); function controlvalue(e) (e="=null)" compute the form validation value to be sent server var type="e.getAttribute("type");" if(type!="null" && type.tolowercase()="="checkbox")" e.checked; e.value; tovalue(e) encodeuricomponent(controlvalue(e)); ** * builds a query string in fluent api pattern. @param {htmlelement} owner 'this' control. qs(owner) params : "", append function(s) (this.params.length="=0)" this.params+="?" ; else this.params +="s;" this; }, nearby function(name) e="findNearBy(owner,name);" skip this.append(path.tail(name)+'="+toValue(e));
        },

        addThis : function() {
            return this.append("value="+toValue(owner));
        },

        toString : function() {
            return this.params;
        }
    };
}

// find the nearest ancestor node that has the given tag name
function findAncestor(e, tagName) {
    do {
        e = e.parentNode;
    } while (e != null && e.tagName != tagName);
    return e;
}

function findAncestorClass(e, cssClass) {
    do {
        e = e.parentNode;
    } while (e != null && !Element.hasClassName(e,cssClass));
    return e;
}

function findFollowingTR(input, className) {
    // identify the parent TR
    var tr = input;
    while (tr.tagName != "TR")
        tr = tr.parentNode;

    // then next TR that matches the CSS
    do {
        tr = $(tr).next();
    } while (tr != null && (tr.tagName != "TR" || !Element.hasClassName(tr,className)));

    return tr;
}

function find(src,filter,traversalF) {
    while(src!=null) {
        src = traversalF(src);
        if(src!=null && filter(src))
            return src;
    }
    return null;
}

/**
 * Traverses a form in the reverse document order starting from the given element (but excluding it),
 * until the given filter matches, or run out of an element.
 */
function findPrevious(src,filter) {
    return find(src,filter,function (e) {
        var p = e.previousSibling;
        if(p==null) return e.parentNode;
        while(p.lastChild!=null)
            p = p.lastChild;
        return p;
    });
}

function findNext(src,filter) {
    return find(src,filter,function (e) {
        var n = e.nextSibling;
        if(n==null) return e.parentNode;
        while(n.firstChild!=null)
            n = n.firstChild;
        return n;
    });
}

function findFormItem(src,name,directionF) {
    var name2 = "_."+name; // handles <textbox field="..." /> notation silently
    return directionF(src,function(e){ 
        if (e.tagName == "INPUT" && e.type=="radio" && e.checked==true) {
            var r = 0;
            while (e.name.substring(r,r+8)==" removeme') radio buttons have must unique repeatable blocks so name is prefixed r="e.name.indexOf('_',r+8)+1;" e.name.substring(r); (e.tagname="="INPUT"" e.tagname="="TEXTAREA"" (e.name="=name" e.name="=name2);" }); traverses reverse document order and finds an input element that matches given name. findpreviousformitem(src,name) findformitem(src,name,findprevious); findnextformitem(src,name) findformitem(src,name,findnext); parse html into dom. parsehtml(html) c="document.createElement("div");" c.innerhtml="html;" c.firstchild; evaluates script global context. geval(script) execscript chokes on "" but eval doesn't, we need reject it first. (script="=null" return; see http: perfectionkills.com global-eval-what-are-the-options note cannot (this.execscript eval)(script); emulate firing of event. will fire event {string} like 'change', 'blur', etc. fireevent(element,event){ (document.createevent) dispatch for firefox others evt="document.createEvent("HTMLEvents");" evt.initevent(event, true, true ); type,bubbling,cancelable !element.dispatchevent(evt); ie element.fireevent('on'+event,evt) shared tooltip object tooltip; behavior rules =="======================================================" using tag names css selector makes processing faster registervalidator(e) e.targetelement="findFollowingTR(e," "validation-error-area").firstchild.nextsibling; e.targeturl="function()" url="this.getAttribute("checkUrl");" depends="this.getAttribute("checkDependsOn");" (depends="=null)" legacy behaviour where checkurl javascript try eval(url); access 'this', no 'geval' catch (e) (window.console!="null)" console.warn("legacy '" "' not valid javascript: "+e); (window.yui!="null)" yui.log("legacy "+e,"warn"); url; plain as fallback q="qs(this).addThis();" (depends.length>0)
                depends.split(" ").each(function (n) {
                    q.nearBy(n);
                });
            return url+ q.toString();
        }
    };
    var method = e.getAttribute("checkMethod") || "get";

    var url = e.targetUrl();
    try {
      FormChecker.delayedCheck(url, method, e.targetElement);
    } catch (x) {
        // this happens if the checkUrl refers to a non-existing element.
        // don't let this kill off the entire JavaScript
        YAHOO.log("Failed to register validation method: "+e.getAttribute("checkUrl")+" : "+e);
        return;
    }

    var checker = function() {
        var target = this.targetElement;
        FormChecker.sendRequest(this.targetUrl(), {
            method : method,
            onComplete : function(x) {
                target.innerHTML = x.responseText;
                Behaviour.applySubtree(target);
            }
        });
    }
    var oldOnchange = e.onchange;
    if(typeof oldOnchange=="function") {
        e.onchange = function() { checker.call(this); oldOnchange.call(this); }
    } else
        e.onchange = checker;

    var v = e.getAttribute("checkDependsOn");
    if (v) {
        v.split(" ").each(function (name) {
            var c = findNearBy(e,name);
            if (c==null) {
                if (window.console!=null)  console.warn("Unable to find nearby "+name);
                if (window.YUI!=null)      YUI.log("Unable to find a nearby control of the name "+name,"warn")
                return;
            }
            $(c).observe("change",checker.bind(e));
        });
    }

    e = null; // avoid memory leak
}

function registerRegexpValidator(e,regexp,message) {
    e.targetElement = findFollowingTR(e, "validation-error-area").firstChild.nextSibling;
    var checkMessage = e.getAttribute('checkMessage');
    if (checkMessage) message = checkMessage;
    var oldOnchange = e.onchange;
    e.onchange = function() {
        var set = oldOnchange != null ? oldOnchange.call(this) : false;
        if (this.value.match(regexp)) {
            if (!set) this.targetElement.innerHTML = "<div>";
        } else {
            this.targetElement.innerHTML = "<div class="error">" + message + "</div>";
            set = true;
        }
        return set;
    }
    e.onchange.call(e);
    e = null; // avoid memory leak
}

/**
 * Wraps a <button> into YUI button.
 *
 * @param e
 *      button element
 * @param onclick
 *      onclick handler
 * @return
 *      YUI Button widget.
 */
function makeButton(e,onclick) {
    var h = e.onclick;
    var clsName = e.className;
    var n = e.name;
    var btn = new YAHOO.widget.Button(e,{});
    if(onclick!=null)
        btn.addListener("click",onclick);
    if(h!=null)
        btn.addListener("click",h);
    var be = btn.get("element");
    Element.addClassName(be,clsName);
    if(n) // copy the name
        be.setAttribute("name",n);

    // keep the data-* attributes from the source
    var length = e.attributes.length;
    for (var i = 0; i < length; i++) {
        var attribute = e.attributes[i];
        var attributeName = attribute.name;
        if (attributeName.startsWith('data-')) {
            btn._button.setAttribute(attributeName, attribute.value);
        }
    }
    return btn;
}

/*
    If we are inside 'to-be-removed' class, some HTML altering behaviors interact badly, because
    the behavior re-executes when the removed master copy gets reinserted later.
 */
function isInsideRemovable(e) {
    return Element.ancestors(e).find(function(f){return f.hasClassName("to-be-removed");});
}

/**
 * Render the template captured by &lt;l:renderOnDemand> at the element 'e' and replace 'e' by the content.
 *
 * @param {HTMLElement} e
 *      The place holder element to be lazy-rendered.
 * @param {boolean} noBehaviour
 *      if specified, skip the application of behaviour rule.
 */
function renderOnDemand(e,callback,noBehaviour) {
    if (!e || !Element.hasClassName(e,"render-on-demand")) return;
    var proxy = eval(e.getAttribute("proxy"));
    proxy.render(function (t) {
        var contextTagName = e.parentNode.tagName;
        var c;
        if (contextTagName=="TBODY") {
            c = document.createElement("DIV");
            c.innerHTML = "<table><tbody>"+t.responseText+"</tbody></table>";
            c = c./*JENKINS-15494*/lastChild.firstChild;
        } else {
            c = document.createElement(contextTagName);
            c.innerHTML = t.responseText;
        }

        var elements = [];
        while (c.firstChild!=null) {
            var n = c.firstChild;
            e.parentNode.insertBefore(n,e);
            if (n.nodeType==1 && !noBehaviour)
                elements.push(n);
        }
        Element.remove(e);

        evalInnerHtmlScripts(t.responseText,function() {
            Behaviour.applySubtree(elements,true);
            if (callback)   callback(t);
        });
    });
}

/**
 * Finds all the script tags 
 */
function evalInnerHtmlScripts(text,callback) {
    var q = [];
    var matchAll = new RegExp('<script([^>]*)>([\\S\\s]*?)<\ script>', 'img');
    var matchOne = new RegExp('<script([^>]*)>([\\S\\s]*?)<\ script>', 'im');
    var srcAttr  = new RegExp('src=[\'\"]([^\'\"]+)[\'\"]','i');
    (text.match(matchAll)||[]).map(function(s) {
        var m = s.match(srcAttr);
        if (m) {
            q.push(function(cont) {
                loadScript(m[1],cont);
            });
        } else {
            q.push(function(cont) {
                geval(s.match(matchOne)[2]);
                cont();
            });
        }
    });
    q.push(callback);
    sequencer(q);
}

/**
 * Take an array of (typically async) functions and run them in a sequence.
 * Each of the function in the array takes one 'continuation' parameter, and upon the completion
 * of the function it needs to invoke "continuation()" to signal the execution of the next function.
 */
function sequencer(fs) {
    var nullFunction = function() {}
    function next() {
        if (fs.length>0) {
            (fs.shift()||nullFunction)(next);
        }
    }
    return next();
}

/** @deprecated Use {@link Behaviour.specify} instead. */
var jenkinsRules = {
// TODO convert as many as possible to Behaviour.specify calls; some seem to have an implicit order dependency, but what?
    "BODY" : function() {
        tooltip = new YAHOO.widget.Tooltip("tt", {context:[], zindex:999});
    },

    "TABLE.sortable" : function(e) {// sortable table
        e.sortable = new Sortable.Sortable(e);
    },

    "TABLE.progress-bar" : function(e) { // progressBar.jelly
        e.onclick = function() {
            var href = this.getAttribute("href");
            if(href!=null)      window.location = href;
        }
        e = null; // avoid memory leak
    },

    "INPUT.expand-button" : function(e) {
        makeButton(e,function(e) {
            var link = e.target;
            while(!Element.hasClassName(link,"advancedLink"))
                link = link.parentNode;
            link.style.display = "none";
            $(link).next().style.display="block";
            layoutUpdateCallback.call();
        });
        e = null; // avoid memory leak
    },

// scripting for having default value in the input field
    "INPUT.has-default-text" : function(e) {
        var defaultValue = e.value;
        Element.addClassName(e, "defaulted");
        e.onfocus = function() {
            if (this.value == defaultValue) {
                this.value = "";
                Element.removeClassName(this, "defaulted");
            }
        }
        e.onblur = function() {
            if (this.value == "") {
                this.value = defaultValue;
                Element.addClassName(this, "defaulted");
            }
        }
        e = null; // avoid memory leak
    },

// <label> that doesn't use ID, so that it can be copied in <repeatable>
    "LABEL.attach-previous" : function(e) {
        e.onclick = function() {
            var e = $(this).previous();
            while (e!=null) {
                if (e.tagName=="INPUT") {
                    e.click();
                    break;
                }
                e = e.previous();
            }
        }
        e = null;
    },

// form fields that are validated via AJAX call to the server
// elements with this class should have two attributes 'checkUrl' that evaluates to the server URL.
    "INPUT.validated" : registerValidator,
    "SELECT.validated" : registerValidator,
    "TEXTAREA.validated" : registerValidator,

// validate required form values
    "INPUT.required" : function(e) { registerRegexpValidator(e,/./,"Field is required"); },

// validate form values to be an integer
    "INPUT.number" : function(e) { registerRegexpValidator(e,/^(\d+|)$/,"Not an integer"); },
    "INPUT.number-required" : function(e) { registerRegexpValidator(e,/^\-?(\d+)$/,"Not an integer"); },

    "INPUT.non-negative-number-required" : function(e) {
        registerRegexpValidator(e,/^\d+$/,"Not a non-negative number");
    },

    "INPUT.positive-number" : function(e) {
        registerRegexpValidator(e,/^(\d*[1-9]\d*|)$/,"Not a positive integer");
    },
    "INPUT.positive-number-required" : function(e) {
        registerRegexpValidator(e,/^[1-9]\d*$/,"Not a positive integer");
    },

    "INPUT.auto-complete": function(e) {// form field with auto-completion support 
        // insert the auto-completion container
        var div = document.createElement("DIV");
        e.parentNode.insertBefore(div,$(e).next()||null);
        e.style.position = "relative"; // or else by default it's absolutely positioned, making "width:100%" break

        var ds = new YAHOO.util.XHRDataSource(e.getAttribute("autoCompleteUrl"));
        ds.responseType = YAHOO.util.XHRDataSource.TYPE_JSON;
        ds.responseSchema = {
            resultsList: "suggestions",
            fields: ["name"]
        };
        
        // Instantiate the AutoComplete
        var ac = new YAHOO.widget.AutoComplete(e, div, ds);
        ac.generateRequest = function(query) {
            return "?value=" + query;
        };
        ac.prehighlightClassName = "yui-ac-prehighlight";
        ac.animSpeed = 0;
        ac.formatResult = ac.formatEscapedResult;
        ac.useShadow = true;
        ac.autoSnapContainer = true;
        ac.delimChar = e.getAttribute("autoCompleteDelimChar");
        ac.doBeforeExpandContainer = function(textbox,container) {// adjust the width every time we show it
            container.style.width=textbox.clientWidth+"px";
            var Dom = YAHOO.util.Dom;
            Dom.setXY(container, [Dom.getX(textbox), Dom.getY(textbox) + textbox.offsetHeight] );
            return true;
        }
    },

    "A.help-button" : function(e) {
        e.onclick = function() {
            var tr = findFollowingTR(this, "help-area");
            var div = $(tr).down().next().down();

            if (div.style.display != "block") {
                div.style.display = "block";
                // make it visible
                new Ajax.Request(this.getAttribute("helpURL"), {
                    method : 'get',
                    onSuccess : function(x) {
                        var from = x.getResponseHeader("X-Plugin-From");
                        div.innerHTML = x.responseText+(from?"<div class="from-plugin">"+from+"</div>":"");
                        layoutUpdateCallback.call();
                    },
                    onFailure : function(x) {
                        div.innerHTML = "<b>ERROR</b>: Failed to load help file: " + x.statusText;
                        layoutUpdateCallback.call();
                    }
                });
            } else {
                div.style.display = "none";
                layoutUpdateCallback.call();
            }

            return false;
        };
        e.tabIndex = 9999; // make help link unnavigable from keyboard
        e = null; // avoid memory leak
    },

    // Script Console : settings and shortcut key
    "TEXTAREA.script" : function(e) {
        (function() {
            var cmdKeyDown = false;
            var mode = e.getAttribute("script-mode") || "text/x-groovy";
            var readOnly = eval(e.getAttribute("script-readOnly")) || false;
            
            var w = CodeMirror.fromTextArea(e,{
              mode: mode,
              lineNumbers: true,
              matchBrackets: true,
              readOnly: readOnly,
              onKeyEvent: function(editor, event){
                function isGeckoCommandKey() {
                    return Prototype.Browser.Gecko && event.keyCode == 224
                }
                function isOperaCommandKey() {
                    return Prototype.Browser.Opera && event.keyCode == 17
                }
                function isWebKitCommandKey() {
                    return Prototype.Browser.WebKit && (event.keyCode == 91 || event.keyCode == 93)
                }
                function isCommandKey() {
                    return isGeckoCommandKey() || isOperaCommandKey() || isWebKitCommandKey();
                }
                function isReturnKeyDown() {
                    return event.type == 'keydown' && event.keyCode == Event.KEY_RETURN;
                }
                function getParentForm(element) {
                    if (element == null) throw 'not found a parent form';
                    if (element instanceof HTMLFormElement) return element;
                    
                    return getParentForm(element.parentNode);
                }
                function saveAndSubmit() {
                    editor.save();
                    getParentForm(e).submit();
                    event.stop();
                }
                
                // Mac (Command + Enter)
                if (navigator.userAgent.indexOf('Mac') > -1) {
                    if (event.type == 'keydown' && isCommandKey()) {
                        cmdKeyDown = true;
                    }
                    if (event.type == 'keyup' && isCommandKey()) {
                        cmdKeyDown = false;
                    }
                    if (cmdKeyDown && isReturnKeyDown()) {
                        saveAndSubmit();
                        return true;
                    }
                  
                // Windows, Linux (Ctrl + Enter)
                } else {
                    if (event.ctrlKey && isReturnKeyDown()) {
                        saveAndSubmit();
                        return true;
                    }
                }
              }
            }).getWrapperElement();
            w.setAttribute("style","border:1px solid black; margin-top: 1em; margin-bottom: 1em")
        })();
	},

// deferred client-side clickable map.
// this is useful where the generation of <map> element is time consuming
    "IMG[lazymap]" : function(e) {
        new Ajax.Request(
            e.getAttribute("lazymap"),
            {
                method : 'get',
                onSuccess : function(x) {
                    var div = document.createElement("div");
                    document.body.appendChild(div);
                    div.innerHTML = x.responseText;
                    var id = "map" + (iota++);
                    div.firstChild.setAttribute("name", id);
                    e.setAttribute("usemap", "#" + id);
                }
            });
    },

    // resizable text area
    "TEXTAREA" : function(textarea) {
        if(Element.hasClassName(textarea,"rich-editor")) {
            // rich HTML editor
            try {
                var editor = new YAHOO.widget.Editor(textarea, {
                    dompath: true,
                    animate: true,
                    handleSubmit: true
                });
                // probably due to the timing issue, we need to let the editor know
                // that DOM is ready
                editor.DOMReady=true;
                editor.fireQueue();
                editor.render();
                layoutUpdateCallback.call();
            } catch(e) {
                alert(e);
            }
            return;
        }

        // CodeMirror inserts a wrapper element next to the textarea.
        // textarea.nextSibling may not be the handle.
        var handles = findElementsBySelector(textarea.parentNode, ".textarea-handle");
        if(handles.length != 1) return;
        var handle = handles[0];

        var Event = YAHOO.util.Event;

        function getCodemirrorScrollerOrTextarea(){
            return textarea.codemirrorObject ? textarea.codemirrorObject.getScrollerElement() : textarea;
        }
        handle.onmousedown = function(ev) {
            ev = Event.getEvent(ev);
            var s = getCodemirrorScrollerOrTextarea();
            var offset = s.offsetHeight-Event.getPageY(ev);
            s.style.opacity = 0.5;
            document.onmousemove = function(ev) {
                ev = Event.getEvent(ev);
                function max(a,b) { if(a<b) return b; else a; } s.style.height="max(32," offset + event.getpagey(ev)) 'px'; layoutupdatecallback.call(); false; }; document.onmouseup="function()" { document.onmousemove="null;" var s="getCodemirrorScrollerOrTextarea();" s.style.opacity="1;" handle.ondblclick="function()" ; to get actual height of the textbox, shrink it and show its scrollbar }, structured form submission "form" : function(form) crumb.appendtoform(form); if(element.hasclassname(form, "no-json")) return; add hidden 'json' input field, which receives structure in json div="document.createElement("div");" div.innerhtml="<input type=hidden name=json value=init>" form.appendchild(div); oldonsubmit="form.onsubmit;" if (typeof "function") form.onsubmit="function()" buildformtree(this) && oldonsubmit.call(this); buildformtree(this); memory leak prevention hook up tooltip. nodismiss you'd like display tooltip forever as long mouse is on element. "[tooltip]" function(e) applytooltip(e,e.getattribute("tooltip")); "input.submit-button" makebutton(e); "input.yui-button" "tr.optional-block-start": see optionalblock.jelly set start.ref checkbox preparation row-set-end processing e.setattribute("ref", checkbox.id="cb" +(iota++)); rowvisibilitygrouptest "tr.rowvg-start" figure out corresponding end marker function findend(e) for( depth="0;" e="$(e).next())" if(element.hasclassname(e,"rowvg-start")) depth++; if(element.hasclassname(e,"rowvg-end")) depth--; if(depth="=0)" e; e.rowvisibilitygroup="{" outervisible: true, innervisible: ** * tr that marks beginning this visibility group. start: e, end: findend(e), considers row group from point view outside. you think a logical dom node, akin .style.display. makeoutervisible function(b) this.outervisible="b;" this.updatevisibility(); rows since all rowvg shares single visibility, just needs be one boolean, opposed many. children's makeinnervisible this.innervisible="b;" based innervisible outervisible, update relevant rows' css attribute. updatevisibility function() this.innervisible) ? "" "none"; for (var e!="this.end;" (e.rowvisibilitygroup e.rowvisibilitygroup.makeoutervisible(this.innervisible); above call updates e.rowvisibilitygroup.end inclusive e.style.display="display;" enumerate each pass given function. @param {boolean} recursive visits nested groups. eachrow function(recursive,f) (recursive) f(e); throw "not implemented yet"; "tr.row-set-end": rowset.jelly start block if(e.hasclassname("row-set-end")) if(e.hasclassname("row-set-start")) break; @ref refers id element controls object created these we don't find it, turn node into governing (thus result an intermediate that's always on.) ref="start.getAttribute("ref");" if(ref="=null)" start.id="ref" = "rowsetstart"+(iota++); applynameref(start,end,ref); "tr.optional-block-start ": suffixed by pointless string so two optional-block-start can sandwich requires "tr.row-set-end" mark updateoptionalblock(checkbox,false); image shows [+] or [-], with hover effect. oncollapsed onexpanded will called when button triggered. "img.fold-control" changeto(e,img) src="e.src;" e.src="src.substring(0,src.lastIndexOf('/'))+"/"+e.getAttribute("state")+img;" e.onmouseover="function()" changeto(this,"-hover.png"); e.onmouseout="function()" changeto(this,".png"); e.parentnode.onclick="function(event)" if(s="="plus")" e.setattribute("state","minus"); if(e.onexpanded) e.onexpanded(); e.setattribute("state","plus"); if(e.oncollapsed) e.oncollapsed(); changeto(e,"-hover.png"); yahoo.util.event.stopevent(event); editablecombobox.jelly "input.combobox" function(c) next after <input class="combobox"> should be <div class="combobox-values">
        var vdiv = $(c).next();
        if (vdiv.hasClassName("combobox-values")) {
            createComboBox(c, function() {
                return vdiv.childElements().collect(function(value) {
                    return value.getAttribute('value');
                });
            });
        }
    },

    // dropdownList.jelly
    "SELECT.dropdownList" : function(e) {
        if(isInsideRemovable(e))    return;

        var subForms = [];
        var start = $(findFollowingTR(e, 'dropdownList-container')).down().next(), end;
        do { start = start.firstChild; } while (start && start.tagName != 'TR');

        if (start && !Element.hasClassName(start,'dropdownList-start'))
            start = findFollowingTR(start, 'dropdownList-start');
        while (start != null) {
            subForms.push(start);
            start = findFollowingTR(start, 'dropdownList-start');
        }

        // control visibility
        function updateDropDownList() {
            for (var i = 0; i < subForms.length; i++) {
                var show = e.selectedIndex == i;
                var f = $(subForms[i]);

                if (show)   renderOnDemand(f.next());
                f.rowVisibilityGroup.makeInnerVisible(show);

                // TODO: this is actually incorrect in the general case if nested vg uses field-disabled
                // so far dropdownList doesn't create such a situation.
                f.rowVisibilityGroup.eachRow(true, show?function(e) {
                    e.removeAttribute("field-disabled");
                } : function(e) {
                    e.setAttribute("field-disabled","true");
                });
            }
        }

        e.onchange = updateDropDownList;

        updateDropDownList();
    },

    "A.showDetails" : function(e) {
        e.onclick = function() {
            this.style.display = 'none';
            $(this).next().style.display = 'block';
            layoutUpdateCallback.call();
            return false;
        };
        e = null; // avoid memory leak
    },

    "DIV.behavior-loading" : function(e) {
        e.style.display = 'none';
    },

    ".button-with-dropdown" : function (e) {
        new YAHOO.widget.Button(e, { type: "menu", menu: $(e).next() });
    },

    ".track-mouse" : function (element) {
        var DOM = YAHOO.util.Dom;

        $(element).observe("mouseenter",function () {
            element.addClassName("mouseover");

            var mousemoveTracker = function (event) {
                var elementRegion = DOM.getRegion(element);
                if (event.x < elementRegion.left || event.x > elementRegion.right ||
                    event.y < elementRegion.top || event.y > elementRegion.bottom) {
                    element.removeClassName("mouseover");
                    Element.stopObserving(document, "mousemove", mousemoveTracker);
                }
            };
            Element.observe(document, "mousemove", mousemoveTracker);
        });
    },

    /*
        Use on div tag to make it sticky visible on the bottom of the page.
        When page scrolls it remains in the bottom of the page
        Convenient on "OK" button and etc for a long form page
     */
    "#bottom-sticker" : function(sticker) {
        var DOM = YAHOO.util.Dom;

        var shadow = document.createElement("div");
        sticker.parentNode.insertBefore(shadow,sticker);

        var edge = document.createElement("div");
        edge.className = "bottom-sticker-edge";
        sticker.insertBefore(edge,sticker.firstChild);

        function adjustSticker() {
            shadow.style.height = sticker.offsetHeight + "px";

            var viewport = DOM.getClientRegion();
            var pos = DOM.getRegion(shadow);

            sticker.style.position = "fixed";

            var bottomPos = Math.max(0, viewport.bottom - pos.bottom);

            sticker.style.bottom = bottomPos + "px"
            sticker.style.left = Math.max(0,pos.left-viewport.left) + "px"
        }

        // react to layout change
        Element.observe(window,"scroll",adjustSticker);
        Element.observe(window,"resize",adjustSticker);
        // initial positioning
        Element.observe(window,"load",adjustSticker);
        Event.observe(window, 'jenkins:bottom-sticker-adjust', adjustSticker);
        adjustSticker();
        layoutUpdateCallback.add(adjustSticker);
    },

    "#top-sticker" : function(sticker) {// legacy
        this[".top-sticker"](sticker);
    },

    /**
     * @param {HTMLElement} sticker
     */
    ".top-sticker" : function(sticker) {
        var DOM = YAHOO.util.Dom;

        var shadow = document.createElement("div");
        sticker.parentNode.insertBefore(shadow,sticker);

        var edge = document.createElement("div");
        edge.className = "top-sticker-edge";
        sticker.insertBefore(edge,sticker.firstChild);

        var initialBreadcrumbPosition = DOM.getRegion(shadow);
        function adjustSticker() {
            shadow.style.height = sticker.offsetHeight + "px";

            var viewport = DOM.getClientRegion();
            var pos = DOM.getRegion(shadow);

            sticker.style.position = "fixed";
            if(pos.top <= 99999999 initialbreadcrumbposition.top) { sticker.style.top="Math.max(0," pos.top-viewport.top) + "px" } sticker.style.left="Math.max(0,pos.left-viewport.left)" react to layout change element.observe(window,"scroll",adjuststicker); element.observe(window,"resize",adjuststicker); initial positioning element.observe(window,"load",adjuststicker); adjuststicker(); }; ** @deprecated use {@link behaviour.specify} instead. * var hudsonrules="jenkinsRules;" legacy name (function() p="20;" for (var selector in jenkinsrules) behaviour.specify(selector, 'hudson-behavior', p++, jenkinsrules[selector]); delete jenkinsrules[selector]; })(); now empty, but plugins can stuff things here later: behaviour.register(hudsonrules); function applytooltip(e,text) copied from yahoo.widget.tooltip.prototype.configcontext efficiently add a new element event registration via yahoo.util.event.addlistener leaks memory, so do it by ourselves e.onmouseover="function(ev)" delay="this.getAttribute("nodismiss")!=null" ? : 5000; tooltip.cfg.setproperty("autodismissdelay",delay); return tooltip.oncontextmouseover.call(this,yahoo.util.event.getevent(ev),tooltip); e.onmousemove="function(ev)" tooltip.oncontextmousemove.call(this,yahoo.util.event.getevent(ev),tooltip); e.onmouseout="function(ev)" tooltip.oncontextmouseout .call(this,yahoo.util.event.getevent(ev),tooltip); e.title="text;" e="null;" avoid memory leak path="{" tail function(p) idx="p.lastIndexOf("/");" if (idx<0) p; p.substring(idx+1); install handlers based on the 'filldependson' attribute. refillonchange(e,onchange) deps="[];" h() params="{};" deps.each(function (d) params[d.name]="controlValue(d.control);" }); onchange(params); v="e.getAttribute("fillDependsOn");" (v!="null)" v.split(" ").each(function (name) c="findNearBy(e,name);" (c="=null)" (window.console!="null)" console.warn("unable find nearby "+name); (window.yui!="null)" yui.log("unable control of "+name,"warn") return; $(c).observe("change",h); deps.push({name:path.tail(name),control:c}); h(); fill xor(a,b) convert both values boolean '!' and then a!="b" !a !="!b;" used editabledescription.jelly replace description field with form replacedescription() d="document.getElementById("description");" $(d).down().next().innerhtml="<div class='spinner-right'>loading...</div>" ; ajax.request( ". descriptionform", oncomplete function(x) d.innerhtml="x.responseText;" evalinnerhtmlscripts(x.responsetext,function() behaviour.applysubtree(d); d.getelementsbytagname("textarea")[0].focus(); layoutupdatecallback.call(); ); false; indicates that fields rows [s,e) should be grouped into json object, attached under identified specified id. applynameref(s,e,id) $(id).groupingnode="true;" s contains node itself for(var x="$(s).next();" x!="e;" handle nested <f:rowset> correctly, don't overwrite the existing value
        if(x.getAttribute("nameRef")==null)
            x.setAttribute("nameRef",id);
    }
}


// used by optionalBlock.jelly to update the form status
//   @param c     checkbox element
function updateOptionalBlock(c,scroll) {
    // find the start TR
    var s = $(c);
    while(!s.hasClassName("optional-block-start"))
        s = s.up();

    // find the beginning of the rowvg
    var vg =s;
    while (!vg.hasClassName("rowvg-start"))
        vg = vg.next();

    var checked = xor(c.checked,Element.hasClassName(c,"negative"));

    vg.rowVisibilityGroup.makeInnerVisible(checked);

    if(checked && scroll) {
        var D = YAHOO.util.Dom;

        var r = D.getRegion(s);
        r = r.union(D.getRegion(vg.rowVisibilityGroup.end));
        scrollIntoView(r);
    }

    if (c.name == 'hudson-tools-InstallSourceProperty') {
        // Hack to hide tool home when "Install automatically" is checked.
        var homeField = findPreviousFormItem(c, 'home');
        if (homeField != null && homeField.value == '') {
            var tr = findAncestor(homeField, 'TR');
            if (tr != null) {
                tr.style.display = c.checked ? 'none' : '';
                layoutUpdateCallback.call();
            }
        }
    }
}


//
// Auto-scroll support for progressive log output.
//   See http://radio.javaranch.com/pascarello/2006/08/17/1155837038219.html
//
function AutoScroller(scrollContainer) {
    // get the height of the viewport.
    // See http://www.howtocreate.co.uk/tutorials/javascript/browserwindow
    function getViewportHeight() {
        if (typeof( window.innerWidth ) == 'number') {
            //Non-IE
            return window.innerHeight;
        } else if (document.documentElement && ( document.documentElement.clientWidth || document.documentElement.clientHeight )) {
            //IE 6+ in 'standards compliant mode'
            return document.documentElement.clientHeight;
        } else if (document.body && ( document.body.clientWidth || document.body.clientHeight )) {
            //IE 4 compatible
            return document.body.clientHeight;
        }
        return null;
    }

    return {
        bottomThreshold : 25,
        scrollContainer: scrollContainer,

        getCurrentHeight : function() {
            var scrollDiv = $(this.scrollContainer);

            if (scrollDiv.scrollHeight > 0)
                return scrollDiv.scrollHeight;
            else
                if (scrollDiv.offsetHeight > 0)
                    return scrollDiv.offsetHeight;

            return null; // huh?
        },

        // return true if we are in the "stick to bottom" mode
        isSticking : function() {
            var scrollDiv = $(this.scrollContainer);
            var currentHeight = this.getCurrentHeight();

            // when used with the BODY tag, the height needs to be the viewport height, instead of
            // the element height.
            //var height = ((scrollDiv.style.pixelHeight) ? scrollDiv.style.pixelHeight : scrollDiv.offsetHeight);
            var height = getViewportHeight();
            var scrollPos = Math.max(scrollDiv.scrollTop, document.documentElement.scrollTop);
            var diff = currentHeight - scrollPos - height;
            // window.alert("currentHeight=" + currentHeight + ",scrollTop=" + scrollDiv.scrollTop + ",height=" + height);

            return diff < this.bottomThreshold;
        },

        scrollToBottom : function() {
            var scrollDiv = $(this.scrollContainer);
            var currentHeight = this.getCurrentHeight();
            if(document.documentElement) document.documentElement.scrollTop = currentHeight
            scrollDiv.scrollTop = currentHeight;
        }
    };
}

// scroll the current window to display the given element or the region.
function scrollIntoView(e) {
    function calcDelta(ex1,ex2,vx1,vw) {
        var vx2=vx1+vw;
        var a;
        a = Math.min(vx1-ex1,vx2-ex2);
        if(a>0)     return -a;
        a = Math.min(ex1-vx1,ex2-vx2);
        if(a>0)     return a;
        return 0;
    }

    var D = YAHOO.util.Dom;

    var r;
    if(e.tagName!=null) r = D.getRegion(e);
    else                r = e;

    var dx = calcDelta(r.left,r.right, document.body.scrollLeft, D.getViewportWidth());
    var dy = calcDelta(r.top, r.bottom,document.body.scrollTop,  D.getViewportHeight());
    window.scrollBy(dx,dy);
}

// used in expandableTextbox.jelly to change a input field into a text area
function expandTextArea(button,id) {
    button.style.display="none";
    var field = button.parentNode.previousSibling.children[0];
    var value = field.value.replace(/ +/g,'\n');
    
    var n = button; 
    while (n.tagName != "TABLE")
    {
        n = n.parentNode;
    }

    var parent = n.parentNode;
    parent.innerHTML = "<textarea rows="8" class="setting-input"></textarea>";
    var textArea = parent.childNodes[0];
    textArea.name = field.name;
    textArea.innerText = value;

    layoutUpdateCallback.call();
}

// refresh a part of the HTML specified by the given ID,
// by using the contents fetched from the given URL.
function refreshPart(id,url) {
    var intervalID = null;
    var f = function() {
        if(isPageVisible()) {
            new Ajax.Request(url, {
                onSuccess: function(rsp) {
                    var hist = $(id);
                    if (hist == null) {
                        console.log("There's no element that has ID of " + id);
                        if (intervalID !== null)
                            window.clearInterval(intervalID);
                        return;
                    }
                    if (!rsp.responseText) {
                        console.log("Failed to retrieve response for ID " + id + ", perhaps Jenkins is unavailable");
                        return;
                    }
                    var p = hist.up();

                    var div = document.createElement('div');
                    div.innerHTML = rsp.responseText;

                    var node = $(div).firstDescendant();
                    p.replaceChild(node, hist);

                    Behaviour.applySubtree(node);
                    layoutUpdateCallback.call();
                }
            });
        }
    };
    // if run as test, just do it once and do it now to make sure it's working,
    // but don't repeat.
    if(isRunAsTest) f();
    else intervalID = window.setInterval(f, 5000);
}


/*
    Perform URL encode.
    Taken from http://www.cresc.co.jp/tech/java/URLencoding/JavaScript_URLEncoding.htm
    @deprecated Use standard javascript method "encodeURIComponent" instead
*/
function encode(str){
    var s, u;
    var s0 = "";                // encoded str

    for (var i = 0; i < str.length; i++){   // scan the source
        s = str.charAt(i);
        u = str.charCodeAt(i);          // get unicode of the char

        if (s == " "){s0 += "+";}       // SP should be converted to "+"
        else {
            if ( u == 0x2a || u == 0x2d || u == 0x2e || u == 0x5f || ((u >= 0x30) && (u <= 0x39)) || ((u>= 0x41) && (u <= 0x5a)) || ((u>= 0x61) && (u <= 0x7a))){ check for escape s0="s0" + s; don't } else { if ((u>= 0x0) && (u <= 0x7f)){ single byte format s="0" +u.tostring(16); s0 +="%" s.substr(s.length-2); } else if (u> 0x1fffff){     // quaternary byte format (extended)
                    s0 += "%" + (0xF0 + ((u & 0x1c0000) >> 18)).toString(16);
                    s0 += "%" + (0x80 + ((u & 0x3f000) >> 12)).toString(16);
                    s0 += "%" + (0x80 + ((u & 0xfc0) >> 6)).toString(16);
                    s0 += "%" + (0x80 + (u & 0x3f)).toString(16);
                } else
                if (u > 0x7ff){        // triple byte format
                    s0 += "%" + (0xe0 + ((u & 0xf000) >> 12)).toString(16);
                    s0 += "%" + (0x80 + ((u & 0xfc0) >> 6)).toString(16);
                    s0 += "%" + (0x80 + (u & 0x3f)).toString(16);
                } else {                      // double byte format
                    s0 += "%" + (0xc0 + ((u & 0x7c0) >> 6)).toString(16);
                    s0 += "%" + (0x80 + (u & 0x3f)).toString(16);
                }
            }
        }
    }
    return s0;
}

// when there are multiple form elements of the same name,
// this method returns the input field of the given name that pairs up
// with the specified 'base' input element.
Form.findMatchingInput = function(base, name) {
    // find the FORM element that owns us
    var f = base;
    while (f.tagName != "FORM")
        f = f.parentNode;

    var bases = Form.getInputs(f, null, base.name);
    var targets = Form.getInputs(f, null, name);

    for (var i=0; i<bases.length; i++) { if (bases[i]="=" base) return targets[i]; } null; not found function onbuildhistorychange(handler) event.observe(window, 'jenkins:buildhistorychanged', handler); firebuildhistorychanged() event.fire(window, 'jenkins:buildhistorychanged'); updatebuildhistory(ajaxurl,nbuild) if(isrunastest) return; var bh="$('buildHistory');" the build history pane is collapsed, just immediately and don't set up refresh. (bh.hasclassname('collapsed')) buildhistorypage="$('buildHistoryPage');" bh.headers="["n",nBuild];" getdatatable(buildhistorydiv) $(buildhistorydiv).getelementsbyselector('table.pane')[0]; leftrightpadding="4;" checkrowcelloverflows(row) (!row) (element.hasclassname(row, "overflow-checked")) already done. marksingleline() element.addclassname(row, "single-line"); element.removeclassname(row, "multi-line"); markmultiline() indentmultiline(element) element.addclassname(element, "indent-multiline"); blockwrap(el1, el2) div="document.createElement('div');" element.addclassname(div, "block"); "wrap"); element.addclassname(el1, "wrapped"); element.addclassname(el2, el1.parentnode.insertbefore(div, el1); el1.parentnode.removechild(el1); el2.parentnode.removechild(el2); div.appendchild(el1); div.appendchild(el2); div; blockunwrap(element) wrapped="$(element).getElementsBySelector('.wrapped');" for (var i="0;" < wrapped.length; wrappedel="wrapped[i];" wrappedel.parentnode.removechild(wrappedel); element.parentnode.insertbefore(wrappedel, element); element.removeclassname(wrappedel, element.parentnode.removechild(element); buildname="$(row).getElementsBySelector('.build-name')[0];" builddetails="$(row).getElementsBySelector('.build-details')[0];" (!buildname || !builddetails) displayname="$(buildName).getElementsBySelector('.display-name')[0];" buildcontrols="$(row).getElementsBySelector('.build-controls')[0];" desc; descelements="$(row).getElementsBySelector('.desc');" (descelements.length> 0) {
            desc = descElements[0];
        }

        function resetCellOverflows() {
            markSingleline();

            // undo block wraps
            var blockWraps = $(row).getElementsBySelector('.block.wrap');
            for (var i = 0; i < blockWraps.length; i++) {
                blockUnwrap(blockWraps[i]);
            }

            removeZeroWidthSpaces(displayName);
            removeZeroWidthSpaces(desc);
            Element.removeClassName(buildName, "block");
            buildName.removeAttribute('style');
            Element.removeClassName(buildDetails, "block");
            buildDetails.removeAttribute('style');
            if (buildControls) {
                Element.removeClassName(buildControls, "block");
                buildDetails.removeAttribute('style');
            }
        }

        // Undo everything from the previous poll.
        resetCellOverflows();

        // Insert zero-width spaces so as to allow text to wrap, allowing us to get the true clientWidth.
        insertZeroWidthSpacesInElementText(displayName, 2);
        if (desc) {
            insertZeroWidthSpacesInElementText(desc, 30);
            markMultiline();
        }

        var rowWidth = bh.clientWidth;
        var usableRowWidth = rowWidth - (leftRightPadding * 2);
        var nameOverflowParams = getElementOverflowParams(buildName);
        var detailsOverflowParams = getElementOverflowParams(buildDetails);

        var controlsOverflowParams;
        if (buildControls) {
            controlsOverflowParams = getElementOverflowParams(buildControls);
        }

        if (nameOverflowParams.isOverflowed) {
            // If the name is overflowed, lets remove the zero-width spaces we added above and
            // re-add zero-width spaces with a bigger max word sizes.
            removeZeroWidthSpaces(displayName);
            insertZeroWidthSpacesInElementText(displayName, 20);
        }

        function fitToControlsHeight(element) {
            if (buildControls) {
                if (element.clientHeight < buildControls.clientHeight) {
                    $(element).setStyle({height: buildControls.clientHeight.toString() + 'px'});
                }
            }
        }

        function setBuildControlWidths() {
            if (buildControls) {
                var buildBadge = $(buildControls).getElementsBySelector('.build-badge')[0];

                if (buildBadge) {
                    var buildControlsWidth = buildControls.clientWidth;
                    var buildBadgeWidth;

                    var buildStop = $(buildControls).getElementsBySelector('.build-stop')[0];
                    if (buildStop) {
                        $(buildStop).setStyle({width: '24px'});
                        // Minus 24 for the buildStop width,
                        // minus 4 for left+right padding in the controls container
                        buildBadgeWidth = (buildControlsWidth - 24 - leftRightPadding);
                        if (Element.hasClassName(buildControls, "indent-multiline")) {
                            buildBadgeWidth = buildBadgeWidth - 20;
                        }
                        $(buildBadge).setStyle({width: (buildBadgeWidth) + 'px'});
                    } else {
                        $(buildBadge).setStyle({width: '100%'});
                    }
                }
                controlsOverflowParams = getElementOverflowParams(buildControls);
            }
        }
        setBuildControlWidths();

        var controlsRepositioned = false;

        if (nameOverflowParams.isOverflowed || detailsOverflowParams.isOverflowed) {
            // At least one of the cells (name or details) needs to move to a row of its own.

            markMultiline();

            if (buildControls) {

                // We have build controls. Lets see can we find a combination that allows the build controls
                // to sit beside either the build name or the build details.

                var badgesOverflowing = false;
                var nameLessThanHalf = true;
                var detailsLessThanHalf = true;
                var buildBadge = $(buildControls).getElementsBySelector('.build-badge')[0];
                if (buildBadge) {
                    var badgeOverflowParams = getElementOverflowParams(buildBadge);

                    if (badgeOverflowParams.isOverflowed) {
                        // The badges are also overflowing. In this case, we will only attempt to
                        // put the controls on the same line as the name or details (see below)
                        // if the name or details is using less than half the width of the build history
                        // widget.
                        badgesOverflowing = true;
                        nameLessThanHalf = (nameOverflowParams.scrollWidth < usableRowWidth/2);
                        detailsLessThanHalf = (detailsOverflowParams.scrollWidth < usableRowWidth/2);
                    }
                }
                function expandLeftWithRight(leftCellOverFlowParams, rightCellOverflowParams) {
                    // Float them left and right...
                    $(leftCellOverFlowParams.element).setStyle({float: 'left'});
                    $(rightCellOverflowParams.element).setStyle({float: 'right'});

                    if (!leftCellOverFlowParams.isOverflowed && !rightCellOverflowParams.isOverflowed) {
                        // If neither left nor right are overflowed, just leave as is and let them float left and right.
                        return;
                    }
                    if (leftCellOverFlowParams.isOverflowed && !rightCellOverflowParams.isOverflowed) {
                        $(leftCellOverFlowParams.element).setStyle({width: leftCellOverFlowParams.scrollWidth + 'px'});
                        return;
                    }
                    if (!leftCellOverFlowParams.isOverflowed && rightCellOverflowParams.isOverflowed) {
                        $(rightCellOverflowParams.element).setStyle({width: rightCellOverflowParams.scrollWidth + 'px'});
                        return;
                    }
                }

                if ((!badgesOverflowing || nameLessThanHalf) &&
                    (nameOverflowParams.scrollWidth + controlsOverflowParams.scrollWidth <= usablerowwidth)) { build name and controls can go on one row (first row). need to move details down a of its own (second row) by making it block element, forcing wrap. if there are controls, we them up position after the inserting before details. element.addclassname(builddetails, "block"); buildcontrols.parentnode.removechild(buildcontrols); builddetails.parentnode.insertbefore(buildcontrols, builddetails); var wrap="blockWrap(buildName," buildcontrols); element.addclassname(wrap, "build-name-controls"); indentmultiline(builddetails); nameoverflowparams="getElementOverflowParams(buildName);" recalculate expandleftwithright(nameoverflowparams, controlsoverflowparams); setbuildcontrolwidths(); fittocontrolsheight(buildname); } else ((!badgesoverflowing || detailslessthanhalf) && (detailsoverflowparams.scrollwidth + controlsoverflowparams.scrollwidth <="usableRowWidth))" row. make field) onto next (creating second element.addclassname(buildname, indentmultiline(wrap); "build-details-controls"); detailsoverflowparams="getElementOverflowParams(buildDetails);" expandleftwithright(detailsoverflowparams, fittocontrolsheight(builddetails); no suitable combo fits all rows their own. element.addclassname(buildcontrols, indentmultiline(buildcontrols); controlsrepositioned="true;" (buildcontrols !controlsrepositioned) buildbadge="$(buildControls).getElementsBySelector('.build-badge')[0];" (buildbadge) badgeoverflowparams="getElementOverflowParams(buildBadge);" (badgeoverflowparams.isoverflowed) markmultiline(); (!nameoverflowparams.isoverflowed !detailsoverflowparams.isoverflowed element.addclassname(row, "overflow-checked"); function checkallrowcelloverflows() if(isrunastest) return; bh="$('buildHistory');" datatable="getDataTable(bh);" insert zero-width spaces in text that may cause overflow distortions. displaynames="$(bh).getElementsBySelector('.display-name');" for (var i="0;" displaynames.length; i++) insertzerowidthspacesinelementtext(displaynames[i], 2); descriptions="$(bh).getElementsBySelector('.desc');" descriptions.length; insertzerowidthspacesinelementtext(descriptions[i], 30); rows.length; checkrowcelloverflows(row); updatebuildsrefreshinterval="5000;" updatebuilds() if(ispagevisible()){ (bh.headers="=" null) yahoo.log("missing headers buildhistory element"); new ajax.request(ajaxurl, requestheaders: bh.headers, onsuccess: function(rsp) delete with transitive data firstbuildrow="0;" (element.hasclassname(rows[firstbuildrow], "build-search-row")) firstbuildrow++; while (rows.length> 0 && Element.hasClassName(rows[firstBuildRow], "transitive")) {
                        Element.remove(rows[firstBuildRow]);
                    }

                    // insert new rows
                    var div = document.createElement('div');
                    div.innerHTML = rsp.responseText;
                    Behaviour.applySubtree(div);

                    var pivot = rows[firstBuildRow];
                    var newDataTable = getDataTable(div);
                    var newRows = newDataTable.rows;
                    while (newRows.length > 0) {
                        if (pivot !== undefined) {
                            // The data table has rows.  Insert before a "pivot" row (first row).
                            pivot.parentNode.insertBefore(newRows[0], pivot);
                        } else {
                            // The data table has no rows.  In this case, we just add all new rows directly to the
                            // table, one after the other i.e. we don't insert before a "pivot" row (first row).
                            dataTable.appendChild(newRows[0]);
			            }
			        }

                    if (Element.hasClassName(newDataTable, 'hasPageData')) {
                        buildHistoryPage.setAttribute('page-entry-newest', newDataTable.getAttribute('page-entry-newest'));
                    }

                    // next update
                    bh.headers = ["n",rsp.getResponseHeader("n")];
                    checkAllRowCellOverflows();
                    createRefreshTimeout();
                }
	        });
	    } else {
            // Reschedule again
	        createRefreshTimeout();
        }
    }

    var buildRefreshTimeout;
    function createRefreshTimeout() {
        cancelRefreshTimeout();
        buildRefreshTimeout = window.setTimeout(updateBuilds, updateBuildsRefreshInterval);
    }
    function cancelRefreshTimeout() {
        if (buildRefreshTimeout) {
            window.clearTimeout(buildRefreshTimeout);
            buildRefreshTimeout = undefined;
        }
    }

    createRefreshTimeout();
    checkAllRowCellOverflows();

    onBuildHistoryChange(function() {
        checkAllRowCellOverflows();
    });

    function setupHistoryNav() {
        var sidePanel = $('side-panel');
        var buildHistoryPageNav = $('buildHistoryPageNav');

        // Show/hide the nav as the mouse moves into the sidepanel and build history.
        sidePanel.observe('mouseover', function() {
            Element.addClassName($(buildHistoryPageNav), "mouseOverSidePanel");
        });
        sidePanel.observe('mouseout', function() {
            Element.removeClassName($(buildHistoryPageNav), "mouseOverSidePanel");
        });
        bh.observe('mouseover', function() {
            Element.addClassName($(buildHistoryPageNav), "mouseOverSidePanelBuildHistory");
        });
        bh.observe('mouseout', function() {
            Element.removeClassName($(buildHistoryPageNav), "mouseOverSidePanelBuildHistory");
        });

        var pageSearchInput = Element.getElementsBySelector(bh, '.build-search-row input')[0];
        var pageSearchClear = Element.getElementsBySelector(bh, '.build-search-row .clear')[0];
        var pageOne = Element.getElementsBySelector(buildHistoryPageNav, '.pageOne')[0];
        var pageUp = Element.getElementsBySelector(buildHistoryPageNav, '.pageUp')[0];
        var pageDown = Element.getElementsBySelector(buildHistoryPageNav, '.pageDown')[0];

        function hasPageUp() {
            return buildHistoryPage.getAttribute('page-has-up') === 'true';
        }
        function hasPageDown() {
            return buildHistoryPage.getAttribute('page-has-down') === 'true';
        }
        function getNewestEntryId() {
            return buildHistoryPage.getAttribute('page-entry-newest');
        }
        function getOldestEntryId() {
            return buildHistoryPage.getAttribute('page-entry-oldest');
        }
        function updatePageParams(dataTable) {
            buildHistoryPage.setAttribute('page-has-up', dataTable.getAttribute('page-has-up'));
            buildHistoryPage.setAttribute('page-has-down', dataTable.getAttribute('page-has-down'));
            buildHistoryPage.setAttribute('page-entry-newest', dataTable.getAttribute('page-entry-newest'));
            buildHistoryPage.setAttribute('page-entry-oldest', dataTable.getAttribute('page-entry-oldest'));
        }
        function togglePageUpDown() {
            Element.removeClassName($(buildHistoryPageNav), "hasUpPage");
            Element.removeClassName($(buildHistoryPageNav), "hasDownPage");
            if (hasPageUp()) {
                Element.addClassName($(buildHistoryPageNav), "hasUpPage");
            }
            if (hasPageDown()) {
                Element.addClassName($(buildHistoryPageNav), "hasDownPage");
            }
        }
        function logPageParams() {
            console.log('-----');
            console.log('Has up: '   + hasPageUp());
            console.log('Has down: ' + hasPageDown());
            console.log('Newest: '   + getNewestEntryId());
            console.log('Oldest: '   + getOldestEntryId());
            console.log('-----');
        }

        function loadPage(params, focusOnSearch) {
            var searchString = pageSearchInput.value;

            if (searchString !== '') {
                if (params === undefined) {
                    params = {};
                }
                params.search = searchString;
            }

            new Ajax.Request(ajaxUrl + toQueryString(params), {
                onSuccess: function(rsp) {
                    var dataTable = getDataTable(bh);
                    var rows = dataTable.rows;

                    // delete all rows
                    var searchRow;
                    if (Element.hasClassName(rows[0], "build-search-row")) {
                        searchRow = rows[0];
                    }
                    while (rows.length > 0) {
                        Element.remove(rows[0]);
                    }
                    if (searchRow) {
                        dataTable.appendChild(searchRow);
                    }

                    // insert new rows
                    var div = document.createElement('div');
                    div.innerHTML = rsp.responseText;
                    Behaviour.applySubtree(div);

                    var newDataTable = getDataTable(div);
                    var newRows = newDataTable.rows;
                    while (newRows.length > 0) {
                        dataTable.appendChild(newRows[0]);
                    }

                    checkAllRowCellOverflows();
                    updatePageParams(newDataTable);
                    togglePageUpDown();
                    if (!hasPageUp()) {
                        createRefreshTimeout();
                    }

                    if (focusOnSearch) {
                        pageSearchInput.focus();
                    }
                    //logPageParams();
                }
            });
        }

        pageSearchInput.observe('keypress', function(e) {
            var key = e.which || e.keyCode;
            // On enter
            if (key === 13) {
                loadPage({}, true);
            }
        });
        pageSearchClear.observe('click', function() {
            pageSearchInput.value = '';
            loadPage({}, true);
        });
        pageOne.observe('click', function() {
            loadPage();
        });
        pageUp.observe('click', function() {
            loadPage({'newer-than': getNewestEntryId()});
        });
        pageDown.observe('click', function() {
            if (hasPageDown()) {
                cancelRefreshTimeout();
                loadPage({'older-than': getOldestEntryId()});
            } else {
                // wrap back around to the top
                loadPage();
            }
        });

        togglePageUpDown();
        //logPageParams();
    }
    setupHistoryNav();
}

function toQueryString(params) {
    var query = '';
    if (params) {
        for (var paramName in params) {
            if (params.hasOwnProperty(paramName)) {
                if (query === '') {
                    query = '?';
                } else {
                    query += '&';
                }
                query += paramName + '=' + encodeURIComponent(params[paramName]);
            }
        }
    }
    return query;
}

function getElementOverflowParams(element) {
    // First we force it to wrap so we can get those dimension.
    // Then we force it to "nowrap", so we can get those dimension.
    // We can then compare the two sets, which will indicate if
    // wrapping is potentially happening, or not.

    // Force it to wrap.
    Element.addClassName(element, "force-wrap");
    var wrappedClientWidth = element.clientWidth;
    var wrappedClientHeight = element.clientHeight;
    Element.removeClassName(element, "force-wrap");

    // Force it to nowrap. Return the comparisons.
    Element.addClassName(element, "force-nowrap");
    var nowrapClientHeight = element.clientHeight;
    try {
        var overflowParams = {
            element: element,
            clientWidth: wrappedClientWidth,
            scrollWidth: element.scrollWidth,
            isOverflowed: wrappedClientHeight > nowrapClientHeight
        };
        return  overflowParams;
    } finally {
        Element.removeClassName(element, "force-nowrap");
    }
}

var zeroWidthSpace = String.fromCharCode(8203);
var ELEMENT_NODE = 1;
var TEXT_NODE = 3;
function insertZeroWidthSpacesInText(textNode, maxWordSize) {
    if (textNode.textContent.length < maxWordSize) {
        return;
    }

    // capture the original text
    textNode.preZWSText = textNode.textContent;

    var words = textNode.textContent.split(/\s+/);
    var newTextContent = '';

    var splitRegex = new RegExp('.{1,' + maxWordSize + '}', 'g');
    for (var i = 0; i < words.length; i++) {
        var word = words[i];
        var wordTokens = word.match(splitRegex);
        if (wordTokens) {
            for (var ii = 0; ii < wordTokens.length; ii++) {
                if (newTextContent.length === 0) {
                    newTextContent += wordTokens[ii];
                } else {
                    newTextContent += zeroWidthSpace + wordTokens[ii];
                }
            }
        } else {
            newTextContent += word;
        }
        newTextContent += ' ';
    }

    textNode.textContent = newTextContent;
}
function insertZeroWidthSpacesInElementText(element, maxWordSize) {
    if (Element.hasClassName(element, 'zws-inserted')) {
        // already done.
        return;
    }
    if (!element.hasChildNodes()) {
        return;
    }

    var children = element.childNodes;
    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === TEXT_NODE) {
            insertZeroWidthSpacesInText(child, maxWordSize);
        } else if (child.nodeType === ELEMENT_NODE) {
            insertZeroWidthSpacesInElementText(child, maxWordSize);
        }
    }

    Element.addClassName(element, 'zws-inserted');
}
function removeZeroWidthSpaces(element) {
    if (element) {
        if (!Element.hasClassName(element, 'zws-inserted')) {
            // Doesn't have ZWSed text.
            return;
        }
        if (!element.hasChildNodes()) {
            return;
        }

        var children = element.childNodes;
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child.nodeType === TEXT_NODE && child.preZWSText) {
                child.textContent = child.preZWSText;
            } else if (child.nodeType === ELEMENT_NODE) {
                removeZeroWidthSpaces(child);
            }
        }

        Element.removeClassName(element, 'zws-inserted');
    }
}

// get the cascaded computed style value. 'a' is the style name like 'backgroundColor'
function getStyle(e,a){
  if(document.defaultView && document.defaultView.getComputedStyle)
    return document.defaultView.getComputedStyle(e,null).getPropertyValue(a.replace(/([A-Z])/g, "-$1"));
  if(e.currentStyle)
    return e.currentStyle[a];
  return null;
}

function ElementResizeTracker() {
    this.trackedElements = [];

    if(isRunAsTest) {
        return;
    }

    var thisTracker = this;
    function checkForResize() {
        for (var i = 0; i < thisTracker.trackedElements.length; i++) {
            var element = thisTracker.trackedElements[i];
            var currDims = Element.getDimensions(element);
            var lastDims = element.lastDimensions;
            if (currDims.width !== lastDims.width || currDims.height !== lastDims.height) {
                Event.fire(element, 'jenkins:resize');
            }
            element.lastDimensions = currDims;
        }
    }
    Event.observe(window, 'jenkins:resizeCheck', checkForResize);

    function checkForResizeLoop() {
        checkForResize();
        setTimeout(checkForResizeLoop, 200);
    }
    checkForResizeLoop();
}
ElementResizeTracker.prototype.addElement = function(element) {
    for (var i = 0; i < this.trackedElements.length; i++) {
        if (this.trackedElements[i] === element) {
            // we're already tracking it so no need to add it.
            return;
        }
    }
    this.trackedElements.push(element);
}
ElementResizeTracker.prototype.onResize = function(element, handler) {
    element.lastDimensions = Element.getDimensions(element);
    Event.observe(element, 'jenkins:resize', handler);
    this.addElement(element);
}
ElementResizeTracker.fireResizeCheck = function() {
    Event.fire(window, 'jenkins:resizeCheck');
}
var elementResizeTracker = new ElementResizeTracker();

/**
 * Makes sure the given element is within the viewport.
 *
 * @param {HTMLElement} e
 *      The element to bring into the viewport.
 */
function ensureVisible(e) {
    var viewport = YAHOO.util.Dom.getClientRegion();
    var pos      = YAHOO.util.Dom.getRegion(e);

    var Y = viewport.top;
    var H = viewport.height;

    function handleStickers(name,f) {
        var e = $(name);
        if (e) f(e);
        document.getElementsBySelector("."+name).each(f);
    }

    // if there are any stickers around, subtract them from the viewport
    handleStickers("top-sticker",function (t) {
        t = t.clientHeight;
        Y+=t; H-=t;
    });

    handleStickers("bottom-sticker",function (b) {
        b = b.clientHeight;
        H-=b;
    });

    var y = pos.top;
    var h = pos.height;

    var d = (y+h)-(Y+H);
    if (d>0) {
        document.body.scrollTop += d;
    } else {
        var d = Y-y;
        if (d>0)    document.body.scrollTop -= d;
    }
}

// set up logic behind the search box
function createSearchBox(searchURL) {
    var ds = new YAHOO.util.XHRDataSource(searchURL+"suggest");
    ds.responseType = YAHOO.util.XHRDataSource.TYPE_JSON;
    ds.responseSchema = {
        resultsList: "suggestions",
        fields: ["name"]
    };
    var ac = new YAHOO.widget.AutoComplete("search-box","search-box-completion",ds);
    ac.typeAhead = false;
    ac.autoHighlight = false;
    ac.formatResult = ac.formatEscapedResult;
    ac.maxResultsDisplayed = 25;

    var box   = $("search-box");
    var sizer = $("search-box-sizer");
    var comp  = $("search-box-completion");

    Behaviour.addLoadEvent(function(){
        // copy font style of box to sizer
        var ds = sizer.style;
        ds.fontFamily = getStyle(box, "fontFamily");
        ds.fontSize = getStyle(box, "fontSize");
        ds.fontStyle = getStyle(box, "fontStyle");
        ds.fontWeight = getStyle(box, "fontWeight");
    });

    // update positions and sizes of the components relevant to search
    function updatePos() {
        sizer.innerHTML = box.value.escapeHTML();
        var cssWidth, offsetWidth = sizer.offsetWidth;
        if (offsetWidth > 0) {
            cssWidth = offsetWidth + "px";
        } else { // sizer hidden on small screen, make sure resizing looks OK
            cssWidth =  getStyle(sizer, "minWidth");
        }
        box.style.width =
        comp.firstChild.style.minWidth = "calc(60px + " + cssWidth + ")";

        var pos = YAHOO.util.Dom.getXY(box);
        pos[1] += YAHOO.util.Dom.get(box).offsetHeight + 2;
        YAHOO.util.Dom.setXY(comp, pos);
    }

    updatePos();
    box.addEventListener("input", updatePos);
}


/**
 * Finds the DOM node of the given DOM node that acts as a parent in the form submission.
 *
 * @param {HTMLElement} e
 *      The node whose parent we are looking for.
 * @param {HTMLFormElement} form
 *      The form element that owns 'e'. Passed in as a performance improvement. Can be null.
 * @return null
 *      if the given element shouldn't be a part of the final submission.
 */
function findFormParent(e,form,isStatic) {
    isStatic = isStatic || false;

    if (form==null) // caller can pass in null to have this method compute the owning form
        form = findAncestor(e,"FORM");

    while(e!=form) {
        // this is used to create a group where no single containing parent node exists,
        // like <optionalblock>
        var nameRef = e.getAttribute("nameRef");
        if(nameRef!=null)
            e = $(nameRef);
        else
            e = e.parentNode;

        if(!isStatic && e.getAttribute("field-disabled")!=null)
            return null;  // this field shouldn't contribute to the final result

        var name = e.getAttribute("name");
        if(name!=null && name.length>0) {
            if(e.tagName=="INPUT" && !isStatic && !xor(e.checked,Element.hasClassName(e,"negative")))
                return null;  // field is not active

            return e;
        }
    }

    return form;
}

// compute the form field name from the control name
function shortenName(name) {
    // [abc.def.ghi] -> abc.def.ghi
    if(name.startsWith('['))
        return name.substring(1,name.length-1);

    // abc.def.ghi -> ghi
    var idx = name.lastIndexOf('.');
    if(idx>=0)  name = name.substring(idx+1);
    return name;
}



//
// structured form submission handling
//   see https://jenkins.io/redirect/developer/structured-form-submission
function buildFormTree(form) {
    try {
        // I initially tried to use an associative array with DOM elements as keys
        // but that doesn't seem to work neither on IE nor Firefox.
        // so I switch back to adding a dynamic property on DOM.
        form.formDom = {}; // root object

        var doms = []; // DOMs that we added 'formDom' for.
        doms.push(form);

        function addProperty(parent,name,value) {
            name = shortenName(name);
            if(parent[name]!=null) {
                if(parent[name].push==null) // is this array?
                    parent[name] = [ parent[name] ];
                parent[name].push(value);
            } else {
                parent[name] = value;
            }
        }

        // find the grouping parent node, which will have @name.
        // then return the corresponding object in the map
        function findParent(e) {
            var p = findFormParent(e,form);
            if (p==null)    return {};

            var m = p.formDom;
            if(m==null) {
                // this is a new grouping node
                doms.push(p);
                p.formDom = m = {};
                addProperty(findParent(p), p.getAttribute("name"), m);
            }
            return m;
        }

        var jsonElement = null;

        for( var i=0; i<form.elements.length; 4845762 i++ ) { var e="form.elements[i];" if(e.name="="json")" jsonelement="e;" continue; } if(e.tagname="="FIELDSET")" && e.multiple) values="[];" for( o="0;" o<e.options.length; o++ opt="e.options.item(o);" if(opt.selected) values.push(opt.value); addproperty(findparent(e),e.name,values); p; r; type="e.getAttribute("type");" if(type="=null)" ; switch(type.tolowercase()) case "button": "submit": break; "checkbox": p="findParent(e);" checked="xor(e.checked,Element.hasClassName(e,"negative"));" if(!e.groupingnode) v="e.getAttribute("json");" if (v) the special attribute is present, we'll either set value or not. useful for an array of checkboxes we can't use @value because ie6 sets to be "on" it's left unspecified. (checked) addproperty(p, e.name, v); else otherwise it'll bind boolean checked); if(checked) e.formdom="{});" "file": support structured form submission with file uploads, rename field names unique ones, and leave this name mapping information in json. behavior backward incompatible, so only do when if(e.getattribute("jsonaware")!="null)" on="e.getAttribute("originalName");" if(on!="null)" addproperty(p,on,e.name); uniqname="file" +(iota++); addproperty(p,e.name,uniqname); e.setattribute("originalname",e.name); e.name="uniqName;" switch multipart form-data @enctype standard, but ie needs @encoding. form.enctype="form.encoding" = "multipart form-data"; crumb.appendtoform(form); "radio": if(!e.checked) r="0;" while (e.name.substring(r,r+8)="='removeme')" if(e.groupingnode) e.name.substring(r), value: e.value }); e.value); "password": must kept sync redactsecretjsonfortracesanitizer.redact_key "$redact", shortenname(e.name)); default: (e.hasclassname("complex-password-field")) jsonelement.value="Object.toJSON(form.formDom);" clean up i="0;" i<doms.length; doms[i].formdom="null;" return true; catch(e) alert(e+'\n(form not submitted)'); false; ** * @param {boolean} toggle true, will check all page. false, unchecks them all. togglecheckboxes="function(toggle)" inputs="document.getElementsByTagName("input");" for(var i<inputs.length; i++) if(inputs[i].type="==" "checkbox") inputs[i].checked="toggle;" }; used prototype.js it have been removed somewhere between 1.4.0 1.5.1 string.prototype.trim="function()" temp="this;" obj="/^(\s*)([\W\w]*)(\b\s*$)/;" (obj.test(temp)) '$2'); g; (temp.match(obj)) " "); temp; hovernotification="(function()" msgbox; body; animation effect that automatically hide message box dur) dur); o.animateincompleteevent.subscribe(function() window.settimeout(function() msgbox.hide() }, 1500); o; function init() if(msgbox!="null)" return; already initialized div="document.createElement("DIV");" document.body.appendchild(div); div.innerhtml="<div id=hoverNotification><div class=bd></div></div>" body="$('hoverNotification');" msgbox="new" yahoo.widget.overlay(body, visible:false, width:"10em", zindex:1000, effect:{ effect:effect, duration:0.25 msgbox.render(); function(title, anchor, offset) (typeof offset="==" 'undefined') init(); body.innerhtml="title;" xy="YAHOO.util.Dom.getXY(anchor);" xy[0] +="offset;" xy[1] msgbox.cfg.setproperty("xy",xy); msgbox.show(); })(); loads script specified by url. href url load. callback specified, invoked after loaded. @see http: stackoverflow.com questions onload-handler-for-script-tag-in-internet-explorer loadscript(href,callback) head="document.getElementsByTagName("head")[0]" || document.documentelement; script.src="href;" (callback) handle loading done="false;" attach handlers browsers script.onload="script.onreadystatechange" function() ( !done (!this.readystate this.readystate="==" "loaded" "complete") callback(); memory leak null; script.parentnode head.removechild( ); insertbefore instead appendchild circumvent bug. arises a base node (#2709 #4378). head.insertbefore( script, head.firstchild logic behind <f:validatebutton>
function safeValidateButton(yuiButton) {
    var button = yuiButton._button;
    var descriptorUrl = button.getAttribute('data-validate-button-descriptor-url');
    var method = button.getAttribute('data-validate-button-method');
    var checkUrl = descriptorUrl + "/" + method;

    // optional, by default = empty string
    var paramList = button.getAttribute('data-validate-button-with') || '';
    
    validateButton(checkUrl, paramList, yuiButton);
}

// this method should not be called directly, only get called by safeValidateButton
// kept "public" for legacy compatibility
function validateButton(checkUrl,paramList,button) {
  button = button._button;

  var parameters = {};

  paramList.split(',').each(function(name) {
      var p = findPreviousFormItem(button,name);
      if(p!=null) {
        if(p.type=="checkbox")  parameters[name] = p.checked;
        else                    parameters[name] = p.value;
      }
  });

  var spinner = $(button).up("DIV").next();
  var target = spinner.next();
  spinner.style.display="block";

  new Ajax.Request(checkUrl, {
      parameters: parameters,
      onComplete: function(rsp) {
          spinner.style.display="none";
          applyErrorMessage(target, rsp);
          layoutUpdateCallback.call();
          var s = rsp.getResponseHeader("script");
          try {
              geval(s);
          } catch(e) {
              window.alert("failed to evaluate "+s+"\n"+e.message);
          }
      }
  });
}

function applyErrorMessage(elt, rsp) {
    if (rsp.status == 200) {
        elt.innerHTML = rsp.responseText;
    } else {
        var id = 'valerr' + (iota++);
        elt.innerHTML = '<a href onclick="document.getElementById(\'' + id
        + '\').style.display=\'block\';return false">ERROR</a><div id="'
        + id + '" style="display:none">' + rsp.responseText + '</div>';
        var error = document.getElementById('error-description'); // cf. oops.jelly
        if (error) {
            var div = document.getElementById(id);
            while (div.firstChild) {
                div.removeChild(div.firstChild);
            }
            div.appendChild(error);
        }
    }
    Behaviour.applySubtree(elt);
}

// create a combobox.
// @param idOrField
//      ID of the <input type="text"> element that becomes a combobox, or the field itself.
//      Passing an ID is @deprecated since 1.350; use <input class="combobox"> instead.
// @param valueFunction
//      Function that returns all the candidates as an array
function createComboBox(idOrField,valueFunction) {
    var candidates = valueFunction();
    var creator = function() {
        if (typeof idOrField == "string")
          idOrField = document.getElementById(idOrField);
        if (!idOrField) return;
        new ComboBox(idOrField, function(value /*, comboBox*/) {
          var items = new Array();
          if (value.length > 0) { // if no value, we'll not provide anything
            value = value.toLowerCase();
            for (var i = 0; i<candidates.length; i++) { if (candidates[i].tolowercase().indexof(value)>= 0) {
                items.push(candidates[i]);
                if(items.length>20)
                  break; // 20 items in the list should be enough
              }
            }
          }
          return items; // equiv to: comboBox.setItems(items);
        });
    };
    // If an ID given, create when page has loaded (backward compatibility); otherwise now.
    if (typeof idOrField == "string") Behaviour.addLoadEvent(creator); else creator();
}


// Exception in code during the AJAX processing should be reported,
// so that our users can find them more easily.
Ajax.Request.prototype.dispatchException = function(e) {
    throw e;
}

// event callback when layouts/visibility are updated and elements might have moved around
var layoutUpdateCallback = {
    callbacks : [],
    add : function (f) {
        this.callbacks.push(f);
    },
    call : function() {
        for (var i = 0, length = this.callbacks.length; i < length; i++)
            this.callbacks[i]();
    }
}

// Notification bar
// ==============================
// this control displays a single line message at the top of the page, like StackOverflow does
// see ui-samples for more details
var notificationBar = {
    OPACITY : 0.8,
    DELAY : 3000,   // milliseconds to auto-close the notification
    div : null,     // the main 'notification-bar' DIV
    token : null,   // timer for cancelling auto-close

    OK : {// standard option values for typical OK notification
        icon: "accept.png",
        backgroundColor: "#8ae234"
    },
    WARNING : {// likewise, for warning
        icon: "yellow.png",
        backgroundColor: "#fce94f"
    },
    ERROR : {// likewise, for error
        icon: "red.png",
        backgroundColor: "#ef2929",
        sticky: true
    },

    init : function() {
        if (this.div==null) {
            this.div = document.createElement("div");
            YAHOO.util.Dom.setStyle(this.div,"opacity",0);
            this.div.id="notification-bar";
            this.div.style.backgroundColor="#fff";
            document.body.insertBefore(this.div, document.body.firstChild);

            var self = this;
            this.div.onclick = function() {
                self.hide();
            };
        }
    },
    // cancel pending auto-hide timeout
    clearTimeout : function() {
        if (this.token)
            window.clearTimeout(this.token);
        this.token = null;
    },
    // hide the current notification bar, if it's displayed
    hide : function () {
        this.clearTimeout();
        var self = this;
        var out = new YAHOO.util.ColorAnim(this.div, {
            opacity: { to:0 },
            backgroundColor: {to:"#fff"}
        }, 0.3, YAHOO.util.Easing.easeIn);
        out.onComplete.subscribe(function() {
            self.div.style.display = "none";
        })
        out.animate();
    },
    // show a notification bar
    show : function (text,options) {
        options = options || {}

        this.init();
        this.div.style.height = this.div.style.lineHeight = options.height || "40px";
        this.div.style.display = "block";

        if (options.icon)
            text = "<img src=""+rootURL+"/images/24x24/"+options.icon+""> "+text;
        this.div.innerHTML = text;

        new YAHOO.util.ColorAnim(this.div, {
            opacity: { to:this.OPACITY },
            backgroundColor : { to: options.backgroundColor || "#fff" }
        }, 1, YAHOO.util.Easing.easeOut).animate();

        this.clearTimeout();
        var self = this;
        if (!options.sticky)
            this.token = window.setTimeout(function(){self.hide();},this.DELAY);
    }
};
</candidates.length;></form.elements.length;></optionalblock></=></bases.length;></=></=></=></=></=></div></b)></map></repeatable></label></\></script([^></\></script([^></button></div></prefixes.length;>