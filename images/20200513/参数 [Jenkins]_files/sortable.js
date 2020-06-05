/*
The MIT Licence, for code from kryogenix.org

Code downloaded from the Browser Experiments section
of kryogenix.org is licenced under the so-called MIT
licence. The licence is below.

Copyright (c) 1997-date Stuart Langridge

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
*/
/*
Usage
=====

Add the "sortable" CSS class to a table to make it sortable.
The first row must be always table header, and the rest must be table data.
(the script seems to support rows to be fixed at the bottom, but haven't figured out how to use it.)

If the table data is sorted to begin with, you can add 'initialSortDir="up|down"' to the
corresponding cell in the header row to display the direction icon from the beginning.
This is recommended to provide a visual clue that the table can be sorted.

The script guesses the table data, and try to use the right sorting algorithm.
But you can override this behavior by having 'data="..."' attribute on each row,
in which case the sort will be done on that field.
*/

var Sortable = (function() {


    function Sortable(table) {
        this.table = table;
        this.arrows = [];

        var firstRow = this.getFirstRow();
        if (!firstRow) return;

        // We have a first row: assume it's the header, and make its contents clickable links
        firstRow.each(function (cell){
            cell.innerHTML = '<a href="#" class="sortheader">'+this.getInnerText(cell)+'<span class="sortarrow"></span></a>';
            this.arrows.push(cell.firstChild.lastChild);

            var self = this;
            cell.firstChild.onclick = function () {
                self.onClicked(this);
                return false;
            };
        }.bind(this));

        // figure out the initial sort preference
        this.pref = this.getStoredPreference();
        if (this.pref == null) {
            firstRow.each(function (cell,i){
                var initialSortDir = cell.getAttribute("initialSortDir");
                if (initialSortDir != null) {
                    this.pref = {column:i, direction:arrowTable[initialSortDir]};
                }
            }.bind(this));
        }

        this.refresh();
    }

    Sortable.prototype = {
        /**
         * SPAN tags that we use to render directional arrows, for each columns.
         */
        arrows : null /*Array*/,

        /**
         * Current sort preference.
         */
        pref : null /* { column:int, direction:arrow } */,

        getFirstRow : function() {
            if (this.table.rows && this.table.rows.length > 0) {
                return $A(this.table.rows[0].cells);
            }
            return null;
        },

        getDataRows : function() {
            var newRows = [];
            var rows = this.table.rows;
            for (var j = 1; j < rows.length; j++) {
                newRows.push($(rows[j]));
            }
            return newRows;
        },

        /**
         * If there's a persisted sort direction setting, retrieve it
         */
        getStoredPreference : function() {
            var key = this.getStorageKey();
            if(storage.hasKey(key)){
                var val = storage.getItem(key);
                if(val){
                    var vals = val.split(":");
                    if(vals.length == 2) {
                        return {column:parseInt(vals[0]), direction:arrowTable[vals[1]]};
                    }
                }
            }
            return null;
        },


        getStorageKey : function() {
            var uri = document.location;
            var tableIndex = this.getIndexOfSortableTable();
            return "ts_direction::" + uri + "::" + tableIndex;
        },

        savePreference : function() {
            var key = this.getStorageKey();
            storage.setItem(key, this.pref.column + ":" + this.pref.direction.id);
        },

        /**
         * Determine the sort function for the specified column
         */
        getSorter : function(column) {
            var rows = this.table.rows;
            if (rows.length <= 4 50 1979 2017 1) return sorter.fallback; var itm="this.extractData(rows[1].cells[column]).trim();" sorter.determine(itm); }, ** * called when the column header gets clicked. onclicked : function(lnk) { arrow="lnk.lastChild;" th="lnk.parentNode;" if (column="=(this.pref||{}).column)" direction change on same row this.pref.direction="this.pref.direction.next;" } else this.pref="{column:column," direction: arrow.sortdir||arrowtable.up}; arrow.sortdir="this.pref.direction;" remember last sort this this.refresh(); this.savepreference(); call data has changed. reapply current setting to existing rows. @since 1.484 refresh function() (this.pref="=null)" return; not sorting dir="this.pref.direction;" s="this.getSorter(column);" if(dir="==" arrowtable.up) ascending we allow some rows stick top and bottom, so that is our first criteria regardless of function rowpos(r) (r.hasclassname("sorttop")) 0; (r.hasclassname("sortbottom")) 2; 1; rows.sort(function(a,b) x="rowPos(a)-rowPos(b);" (x!="0)" x; s( this.extractdata(a.cells[column]), this.extractdata(b.cells[column])); }.bind(this)); rows.each(function (e) this.table.tbodies[0].appendchild(e); update rendering this.arrows.each(function(e,i){ e.innerhtml="((i==column)" ? arrowtable.none).text; }); getindexofsortabletable function(){ $(document.body).select("table.sortable").indexof(this.table); getinnertext function(el) (typeof el="=" "string") el; "undefined") (el.innertext) el.innertext; needed but it faster str ; cs="el.childNodes;" l="cs.length;" for (var i="0;" < l; i++) switch (cs[i].nodetype) case 1: element_node +="this.getInnerText(cs[i]);" break; 3: text_node str; extract from a cell extractdata function(x) if(x="=null)" ''; if(data!="null)" data; this.getinnertext(x); }; arrowtable="{" up: id: "up", text: "&nbsp;&nbsp;&uarr;" down: "down", "&nbsp;&nbsp;&darr;" none: "none", "&nbsp;&nbsp;&nbsp;" lnkref: null arrowtable.up.next="arrowTable.down;" arrowtable.down.next="arrowTable.up;" matches dates like: "1 ignored content" "03-23-99 1:30 pm also "12-25 13:45:22 always with content!" date_pattern="/^(\d{1,2})[\/-](\d{1,2})[\/-](\d\d|\d\d\d\d)(?:(?:\s*(\d{1,2})?:(\d\d)?(?::(\d\d)?)?)?(?:\s*([aA][mM]|[pP][mM])?))\b/" available functions sorter="{" date function(a,b) note - 2-digit years under are considered post-2000, otherwise they're pre-2000. terrible, preserves behavior. you use sortable.js, please make sure 4-digit year values. todate(x) dmatches="x.match(date_pattern);" month="dmatches[1];" day="dmatches[2];" (year 50) 100) hours="dmatches[4]" || minutes="dmatches[5]" seconds="dmatches[6]" (dmatches[7] && dmatches[7].match( i) 12) new date(year, month, day, hours, minutes, seconds, 0); todate(a) todate(b); currency b="b.replace(/[^0-9.]/g,'');" parsefloat(a) parsefloat(b); percent>]/g,'');
            b = b.replace(/[^0-9.<>]/g,'');
            if (a == "<100") a="99.9" ; else if (a="=" ">0") a = "0.1";
            if (b == "<100") b="99.9" ; else if (b="=" ">0") b = "0.1";
            a = a.replace(/[^0-9.]/g,'');
            b = b.replace(/[^0-9.]/g,'');
            return parseFloat(a) - parseFloat(b);
        },

        numeric : function(a,b) {
            a = parseFloat(a);
            if (isNaN(a)) a = 0;
            b = parseFloat(b);
            if (isNaN(b)) b = 0;
            return a-b;
        },

        caseInsensitive : function(a,b) {
            return sorter.fallback(a.toLowerCase(), b.toLowerCase());
        },

        fallback : function(a,b) {
            if (a==b) return 0;
            if (a</100")></100")></=>