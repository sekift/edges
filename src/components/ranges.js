$.extend(edges, {
    ////////////////////////////////////////////////////
    // Specialised data entry components

    newNumericRangeEntry: function (params) {
        if (!params) {
            params = {}
        }
        edges.NumericRangeEntry.prototype = edges.newSelector(params);
        return new edges.NumericRangeEntry(params);
    },
    NumericRangeEntry: function (params) {
        ///////////////////////////////////////
        // parameters that can be passed in
        this.lower = params.lower === undefined ? false : params.lower;
        this.upper = params.upper === undefined ? false : params.upper;
        this.increment = params.increment || 1;

        this.defaultRenderer = params.defaultRenderer || "newNumericRangeEntryRenderer";

        ///////////////////////////////////////
        // state parameters
        this.from = false;
        this.to = false;

        this.init = function (edge) {
            // first kick the request up to the superclass
            edges.newSelector().init.call(this, edge);

            if (!this.lower || !this.upper) {
                // get the base query and remove any aggregations (for performance purposes)
                var bq = this.edge.cloneBaseQuery();
                bq.clearAggregations();
                bq.size = 0;

                // now add the stats aggregation that we want
                bq.addAggregation(
                    es.newStatsAggregation({
                        name: this.id,
                        field: this.field
                    })
                );

                // issue the query to elasticsearch
                es.doQuery({
                    search_url: this.edge.search_url,
                    queryobj: bq.objectify(),
                    datatype: this.edge.datatype,
                    success: edges.objClosure(this, "querySuccess", ["result"]),
                    error: edges.objClosure(this, "queryFail")
                });
            }
        };

        this.synchronise = function () {
            this.from = this.lower;
            this.to = this.upper;

            // now check to see if there are any range filters set on this field
            if (this.edge.currentQuery) {
                var filters = this.edge.currentQuery.listMust(es.newRangeFilter({field: this.field}));
                for (var i = 0; i < filters.length; i++) {
                    this.to = filters[i].lt;
                    this.from = filters[i].gte;
                }
            }
        };

        /////////////////////////////////////////////
        // functions for handling initilisation from query parameters

        this.querySuccess = function (params) {
            var result = params.result;

            // get the terms from and to out of the stats aggregation
            var agg = result.aggregation(this.id);
            if (this.lower === false) {
                this.lower = agg.min;
            }
            if (this.upper === false) {
                this.upper = agg.max;
            }

            // since this happens asynchronously, we may want to draw
            this.draw();
        };

        this.queryFail = function (params) {
            if (this.lower === false) {
                this.lower = 0;
            }
            if (this.upper === false) {
                this.upper = 0;
            }
        };

        //////////////////////////////////////////////////
        // state change functions

        this.selectRange = function (from, to) {
            var nq = this.edge.cloneQuery();

            // remove any existing filter
            nq.removeMust(es.newRangeFilter({field: this.field}));

            // if the new from and the existing to are the upper and lower then don't add a filter,
            // otherwise create the range
            if (!(from === this.lower && to === this.upper)) {
                // set the range filter
                nq.addMust(es.newRangeFilter({
                    field: this.field,
                    gte: from,
                    lt: to
                }))
            }

            // reset the search page to the start and then trigger the next query
            nq.from = 0;
            this.edge.pushQuery(nq);
            this.edge.doQuery();
        };
    },

    newMultiDateRangeEntry: function (params) {
        if (!params) {
            params = {}
        }
        edges.MultiDateRangeEntry.prototype = edges.newComponent(params);
        return new edges.MultiDateRangeEntry(params);
    },
    MultiDateRangeEntry: function (params) {
        ///////////////////////////////////////////////
        // fields that can be passed in, and their defaults

        // list of field objects, which provide the field itself, and the display name.  e.g.
        // [{field : "monitor.rioxxterms:publication_date", display: "Publication Date"}]
        this.fields = params.fields || [];

        // map from field name (as in this.field[n].field) to a function which will provide
        // the earliest allowed date for that field.  e.g.
        // {"monitor.rioxxterms:publication_date" : earliestDate}
        this.earliest = params.earliest || {};

        // map from field name (as in this.field[n].field) to a function which will provide
        // the latest allowed date for that field.  e.g.
        // {"monitor.rioxxterms:publication_date" : latestDate}
        this.latest = params.latest || {};

        // category for this component, defaults to "selector"
        this.category = params.category || "selector";

        // default earliest date to use in all cases (defaults to start of the unix epoch)
        this.defaultEarliest = params.defaultEarliest || new Date(0);

        // default latest date to use in all cases (defaults to now)
        this.defaultLatest = params.defaultLatest || new Date();

        // default renderer from render pack to use
        this.defaultRenderer = params.defaultRenderer || "newMultiDateRangeRenderer";

        ///////////////////////////////////////////////
        // fields used to track internal state

        this.currentField = false;
        this.fromDate = false;
        this.toDate = false;

        this.touched = false;
        this.dateOptions = {};

        this.init = function (edge) {
            Object.getPrototypeOf(this).init.call(this, edge);
            // this.__proto__.init.call(this, edge);

            // set the initial field
            this.currentField = this.fields[0].field;

            // track the last field, for query building purposes
            this.lastField = false;

            // load the dates once at the init - this means they can't
            // be responsive to the filtering unless they are loaded
            // again at a later date
            this.loadDates();
        };

        //////////////////////////////////////////////
        // functions that can be used to trigger state change

        this.changeField = function (newField) {
            this.lastField = this.currentField;
            if (newField !== this.currentField) {
                this.touched = true;
                this.currentField = newField;
            }
        };

        this.setFrom = function (from) {
            if (from !== this.fromDate) {
                this.touched = true;
                this.fromDate = from;
            }
        };

        this.setTo = function (to) {
            if (to !== this.toDate) {
                this.touched = true;
                this.toDate = to;
            }
        };

        this.triggerSearch = function () {
            if (this.touched) {
                this.touched = false;
                var nq = this.edge.cloneQuery();

                // remove the old filter
                nq.removeMust(es.newRangeFilter({field: this.lastField}));

                // only contrib if there's anything to actually do
                if (!this.currentField || (!this.toDate && !this.fromDate)) {
                    return;
                }

                var range = {field: this.currentField};
                if (this.toDate) {
                    range["lt"] = this.toDate;
                }
                if (this.fromDate) {
                    range["gte"] = this.fromDate;
                }
                nq.addMust(es.newRangeFilter(range));

                // push the new query and trigger the search
                this.edge.pushQuery(nq);
                this.edge.doQuery();
            }
        };

        this.loadDates = function () {
            for (var i = 0; i < this.fields.length; i++) {
                var field = this.fields[i].field;
                var earlyFn = this.earliest[field];
                var lateFn = this.latest[field];

                var early = this.defaultEarliest;
                if (earlyFn) {
                    early = earlyFn();
                }

                var late = this.defaultLatest;
                if (lateFn) {
                    late = lateFn();
                }

                this.dateOptions[field] = {
                    earliest: early,
                    latest: late
                }
            }
        };

        this.currentEarliest = function () {
            if (!this.currentField) {
                return
            }
            if (this.dateOptions[this.currentField]) {
                return this.dateOptions[this.currentField].earliest;
            }
        };

        this.currentLatest = function () {
            if (!this.currentField) {
                return
            }
            if (this.dateOptions[this.currentField]) {
                return this.dateOptions[this.currentField].latest;
            }
        }
    }
});